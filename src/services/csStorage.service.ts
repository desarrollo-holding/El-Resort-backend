import { randomUUID } from 'crypto';
import { Storage } from '@google-cloud/storage';
import { getGcsConfigFromEnv } from '../config/gcs';
import { buildVariants, type ImageProfileKey } from './imageOptimizer';
import type { ImageAssetType } from '../models/shared/imageAsset';

// Formatos vectoriales/animados que no pasan por sharp: recodificarlos a WebP estático les
// haría perder la escala vectorial (SVG) o la animación (GIF), y no ganan nada en tamaño de
// archivo por venir de un ícono o badge ya pequeño. Se suben tal cual, como antes de este
// pipeline, sin carpeta de variantes.
const RASTER_MIME_PREFIX_EXCEPTIONS = new Set(['image/svg+xml', 'image/gif']);

// Válido para CUALQUIER objeto que sube este servicio: nunca se reutiliza una key (timestamp
// +uuid en las carpetas de imagen, timestamp+nombre en el resto), así que cachear "para
// siempre" es correcto por construcción. Sin esto, el CDN/navegador revalida cada rato un
// archivo que jamás va a cambiar.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export type UploadFileResult = {
  /** Compatibilidad con el contrato anterior: key del objeto principal (`orig.webp` si hay carpeta). */
  fileId: string;
  /** URL pública del objeto principal. Un consumidor que solo conozca `url` ya recibe la imagen optimizada. */
  url: string;
} & Partial<ImageAssetType>;

export class GcsStorageService {
  private static getBucket() {
    const { bucket, credentials } = getGcsConfigFromEnv();
    const storage = new Storage({ credentials });
    return storage.bucket(bucket);
  }

  private static publicUrlFor(objectKey: string): string {
    return `https://storage.googleapis.com/${getGcsConfigFromEnv().bucket}/${objectKey}`;
  }

  /**
   * Recupera la key del objeto (para `deleteFile`) a partir de una URL pública ya guardada en
   * un documento. Único punto de esta lógica: antes estaba duplicada en `AreaController` y
   * `ExtraController`, y una tercera copia en `LandingMediaController` es exactamente la
   * "dos listas que algún día no coincidirán" que hay que evitar.
   */
  static extractKeyFromUrl(value: string): string | null {
    if (typeof value !== "string" || !value.trim()) return null;

    try {
      const parsed = new URL(value);
      const marker = `/${getGcsConfigFromEnv().bucket}/`;
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex < 0) return null;

      const fileId = decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length));
      return fileId || null;
    } catch {
      return null;
    }
  }

  /**
   * Sube un objeto suelto (sin carpeta de variantes): usado para video, archivos, y las
   * excepciones SVG/GIF que no pasan por sharp.
   */
  private static async uploadFlatObject(bucket: ReturnType<typeof GcsStorageService.getBucket>, fileName: string, buffer: Buffer, contentType: string) {
    const blob = bucket.file(fileName);
    await blob.save(buffer, { resumable: false, metadata: { contentType, cacheControl: IMMUTABLE_CACHE_CONTROL } });
    return { fileId: fileName, url: this.publicUrlFor(fileName) };
  }

  /**
   * Ningún byte que sube un usuario llega tal cual al navegador: toda imagen rasterizable se
   * decodifica una sola vez, se acota y se recodifica a WebP, y se guarda junto a su escalera
   * de variantes en una carpeta nueva (nunca se sobreescribe una subida anterior):
   *
   *   fotosresort/<timestamp>-<uuid>/orig.webp
   *   fotosresort/<timestamp>-<uuid>/w480.webp
   *   fotosresort/<timestamp>-<uuid>/w768.webp
   *   ...
   *
   * Si falla la subida de alguna variante, se borra la carpeta entera antes de propagar el
   * error: sin eso quedaría una carpeta a medias que ningún documento referencia.
   */
  static async uploadFile({
    fileBuffer,
    originalName,
    mimeType,
    mediaKind,
    imageConstraints,
    imageProfile = 'default',
  }: {
    fileBuffer: Buffer;
    originalName: string;
    mimeType: string;
    mediaKind: 'image' | 'video' | 'file';
    imageConstraints?: any;
    imageProfile?: ImageProfileKey;
  }): Promise<UploadFileResult> {
    const bucket = this.getBucket();
    const timestamp = Date.now();
    const folder = mediaKind === 'image' ? 'fotosresort' : mediaKind === 'video' ? 'videos' : 'files';

    const isRasterizable = mediaKind === 'image' && !RASTER_MIME_PREFIX_EXCEPTIONS.has(mimeType.toLowerCase());

    if (!isRasterizable) {
      const fileName = `${folder}/${timestamp}_${originalName}`;
      const { fileId, url } = await this.uploadFlatObject(bucket, fileName, fileBuffer, mimeType);
      return { fileId, url, variants: [] };
    }

    const built = await buildVariants(fileBuffer, imageProfile);
    const storagePrefix = `${folder}/${timestamp}-${randomUUID()}`;
    const uploadedKeys: string[] = [];

    try {
      const origKey = `${storagePrefix}/orig.webp`;
      await bucket.file(origKey).save(built.orig.buffer, { resumable: false, metadata: { contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL } });
      uploadedKeys.push(origKey);

      const variants: ImageAssetType['variants'] = [];
      for (const variant of built.variants) {
        const variantKey = `${storagePrefix}/w${variant.width}.webp`;
        await bucket.file(variantKey).save(variant.buffer, { resumable: false, metadata: { contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL } });
        uploadedKeys.push(variantKey);
        variants.push({ width: variant.width, height: variant.height, format: variant.format, url: this.publicUrlFor(variantKey) });
      }

      return {
        fileId: origKey,
        url: this.publicUrlFor(origKey),
        storageKey: origKey,
        storagePrefix,
        width: built.width,
        height: built.height,
        variants,
      };
    } catch (error) {
      await Promise.allSettled(uploadedKeys.map((key) => bucket.file(key).delete()));
      throw error;
    }
  }

  /**
   * Borra un objeto. Si `fileId` es el `orig.webp` de una carpeta de variantes, borra la
   * carpeta entera (orig + todas las variantes) para no dejar huérfanos: así los llamadores
   * existentes que ya hacían `deleteFile({fileId: uploaded.fileId})` para rollback o borrado
   * de imagen quedan correctos automáticamente, sin tener que tocar cada uno.
   */
  static async deleteFile({ fileId }: { fileId: string }) {
    try {
      const bucket = this.getBucket();
      const prefix = this.prefixOfOrigWebp(fileId);
      if (prefix) {
        await bucket.deleteFiles({ prefix, force: true });
      } else {
        await bucket.file(fileId).delete();
      }
      return { success: true };
    } catch (error) {
      console.error('Error deleting file from GCS:', error);
      return { success: false, error };
    }
  }

  static async deleteFiles({ fileIds }: { fileIds: string[] }) {
    try {
      const bucket = this.getBucket();
      const prefixes = new Set<string>();
      const singles: string[] = [];

      for (const fileId of fileIds) {
        const prefix = this.prefixOfOrigWebp(fileId);
        if (prefix) prefixes.add(prefix);
        else singles.push(fileId);
      }

      await Promise.all([
        ...Array.from(prefixes).map((prefix) => bucket.deleteFiles({ prefix, force: true })),
        ...singles.map((fileId) => bucket.file(fileId).delete()),
      ]);

      return {
        bucket: getGcsConfigFromEnv().bucket,
        deleted: fileIds.length,
        fileIds,
      };
    } catch (error) {
      console.error('Error deleting files from GCS:', error);
      return {
        bucket: getGcsConfigFromEnv().bucket,
        deleted: 0,
        fileIds: [],
      };
    }
  }

  /** Borra la carpeta de variantes de una imagen a partir de su `storagePrefix`. */
  static async removeVariantsByPrefix(storagePrefix: string) {
    if (!storagePrefix) return;
    try {
      const bucket = this.getBucket();
      await bucket.deleteFiles({ prefix: storagePrefix, force: true });
    } catch (error) {
      console.error('Error deleting image variants from GCS:', error);
    }
  }

  private static prefixOfOrigWebp(fileId: string): string | null {
    const suffix = '/orig.webp';
    if (!fileId.endsWith(suffix)) return null;
    return fileId.slice(0, -suffix.length);
  }

  static async listFilesWithUrls({
    page = 1,
    pageSize = 100,
    prefix = '',
    signed = false,
    expiresIn = 3600,
  }: {
    page?: number;
    pageSize?: number;
    prefix?: string;
    signed?: boolean;
    expiresIn?: number;
  }) {
    const bucket = this.getBucket();

    const [files] = await bucket.getFiles({
      prefix: prefix || undefined,
      maxResults: pageSize * page,
    });

    const offset = (page - 1) * pageSize;
    const paginatedFiles = files.slice(offset, offset + pageSize);

    const data = await Promise.all(
      paginatedFiles.map(async (file) => {
        const [metadata] = await file.getMetadata();

        let url = '';
        if (signed) {
          const [signedUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + expiresIn * 1000,
          });
          url = signedUrl;
        } else {
          url = `https://storage.googleapis.com/${getGcsConfigFromEnv().bucket}/${file.name}`;
        }

        return {
          name: file.name.split('/').pop() || file.name,
          path: file.name,
          url,
          id: file.id || file.name,
          createdAt: metadata.timeCreated,
          updatedAt: metadata.updated,
          lastAccessedAt: metadata.customTime || null,
          contentType: metadata.contentType,
          size: metadata.size ? parseInt(metadata.size as string) : undefined,
        };
      })
    );

    return {
      bucket: getGcsConfigFromEnv().bucket,
      page,
      pageSize,
      prefix,
      signed,
      expiresIn: signed ? expiresIn : null,
      total: files.length,
      count: data.length,
      data,
    };
  }
}
