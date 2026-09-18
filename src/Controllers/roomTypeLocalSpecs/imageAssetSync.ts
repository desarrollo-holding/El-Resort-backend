import { GcsStorageService } from "../../services/csStorage.service";
import { normalizeImageAsset, type ImageAssetType } from "../../models/shared/imageAsset";

/** Carpetas de medios que escribe `GcsStorageService`. La clave de un objeto siempre empieza por una. */
const MEDIA_PREFIXES = ["fotosresort/", "videos/", "files/", "fuentes/"];

/**
 * Clave del objeto (`fotosresort/<id>/orig.webp`) a partir de CUALQUIER forma de su URL.
 *
 * POR QUÉ NO SE USA `GcsStorageService.extractKeyFromUrl` AQUÍ
 * Esa busca el nombre del bucket **actual** dentro de la URL, así que solo reconoce URLs del
 * bucket que esté configurado hoy. Sirve para borrar (no queremos borrar en un bucket ajeno),
 * pero no para decidir si dos URLs son la misma imagen.
 *
 * Y esa distinción no es teórica: el 17/09/2026 se perdieron 183 fotos por confundirlas.
 * `MEDIA_PUBLIC_BASE_URL` hacía que la API devolviera `https://elresort.pe/cms/<clave>` mientras
 * el documento tenía guardado `https://storage.googleapis.com/<bucket>/<clave>`. Al volver del
 * dashboard, ninguna cadena coincidía: `resolveKeptImageAssets` creaba un asset pelado,
 * `diffRemovedImageAssets` daba el original por eliminado y `cleanupRemovedImageAssets` borraba
 * su carpeta entera de variantes. Cada guardado destruía las fotos del guardado anterior.
 *
 * La clave sobrevive a todo eso: cambio de bucket, proxy `/cms`, dominio, http/https, encoding.
 * Por eso la identidad se deriva de ella y no de la cadena completa.
 */
export const mediaKeyFromUrl = (value: string): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;

  let ruta = value.trim();
  try {
    // La base solo se usa para poder parsear rutas relativas (`/cms/...`); nunca se lee.
    ruta = new URL(ruta, "https://placeholder.invalid").pathname;
  } catch {
    /* no era una URL: se busca el prefijo sobre la cadena tal cual */
  }

  for (const prefix of MEDIA_PREFIXES) {
    const i = ruta.indexOf(prefix);
    // Al principio o justo tras una barra: si no, `otrofotosresort/x` daría un falso positivo.
    if (i < 0 || (i > 0 && ruta[i - 1] !== "/")) continue;
    const bruto = ruta.slice(i);
    try {
      return decodeURIComponent(bruto) || null;
    } catch {
      return bruto || null;
    }
  }
  return null;
};

/** Identidad estable de un asset: su clave de objeto, venga de donde venga la URL. */
const keyOf = (asset: ImageAssetType): string | null => asset.storageKey || mediaKeyFromUrl(asset.url);

/**
 * El dashboard sigue mandando "cuáles fotos mantener" como un array de URLs simples
 * (`keepUrls`/`photos`), exactamente como antes de este pipeline — no hace falta que
 * reenvíe el objeto completo con sus variantes. Esta función resuelve cada URL contra las
 * imágenes que YA tiene el documento (que sí conservan `variants[]`) para no perder esa
 * metadata al editar. Se intenta primero por URL exacta y, si no, por clave de objeto, que es
 * lo que hace que un cambio de formato de URL no convierta una foto conservada en una borrada.
 * Una URL que no matchea nada existente (raro; normalmente un dato suelto pegado a mano) se
 * conserva como asset "pelado" sin variantes, en vez de rechazarla.
 */
export const resolveKeptImageAssets = (existingAssets: ImageAssetType[], keptUrls: string[]): ImageAssetType[] => {
  const byUrl = new Map(existingAssets.map((asset) => [asset.url, asset] as const));
  const byKey = new Map<string, ImageAssetType>();
  for (const asset of existingAssets) {
    const key = keyOf(asset);
    if (key && !byKey.has(key)) byKey.set(key, asset);
  }

  return keptUrls
    .map((url) => {
      const exacto = byUrl.get(url);
      if (exacto) return exacto;
      const key = mediaKeyFromUrl(url);
      return (key ? byKey.get(key) : undefined) ?? normalizeImageAsset(url);
    })
    .filter((asset): asset is ImageAssetType => asset !== null);
};

/** Igual que `resolveKeptImageAssets` pero para un campo de una sola imagen (`portada`, `portadaMenu`). */
export const resolveKeptSingleImageAsset = (existing: ImageAssetType | null, rawValue: string): ImageAssetType | null => {
  if (!existing) return normalizeImageAsset(rawValue);
  if (existing.url === rawValue) return existing;

  const actual = keyOf(existing);
  const entrante = mediaKeyFromUrl(rawValue);
  if (actual && entrante && actual === entrante) return existing;

  return normalizeImageAsset(rawValue);
};

/** Concatena conservadas + recién subidas, sin duplicar la misma imagen dos veces. */
export const mergeImageAssets = (kept: ImageAssetType[], uploaded: ImageAssetType[]): ImageAssetType[] => {
  const seen = new Set<string>();
  const merged: ImageAssetType[] = [];
  for (const asset of [...kept, ...uploaded]) {
    const key = asset.storageKey || asset.url;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(asset);
  }
  return merged;
};

/** Misma identidad que `keyOf`, con la URL como último recurso para assets legacy sin clave. */
const identityOf = (asset: ImageAssetType): string => keyOf(asset) || asset.url;

/**
 * Imágenes que estaban en `existing` y ya no están en `surviving`: el usuario las quitó de la
 * galería. Sus variantes en el bucket quedarían huérfanas para siempre si no se limpian.
 */
export const diffRemovedImageAssets = (existing: ImageAssetType[], surviving: ImageAssetType[]): ImageAssetType[] => {
  const survivingKeys = new Set(surviving.map(identityOf));
  return existing.filter((asset) => !survivingKeys.has(identityOf(asset)));
};

/** Igual que `diffRemovedImageAssets` pero para un campo de una sola imagen. */
export const diffRemovedSingleImageAsset = (existing: ImageAssetType | null, next: ImageAssetType | null): ImageAssetType | null => {
  if (!existing) return null;
  if (next && identityOf(next) === identityOf(existing)) return null;
  return existing;
};

/**
 * Borra del storage las imágenes que salieron de un campo. Solo actúa sobre assets con
 * `storageKey` real (los que pasaron por este pipeline); una entrada legacy "pelada"
 * (`storageKey: ""`, un `string` suelto de antes de este pipeline) no tiene nada propio que
 * borrar en el bucket administrado por `GcsStorageService`, así que se ignora.
 */
export const cleanupRemovedImageAssets = async (removed: Array<ImageAssetType | null | undefined>): Promise<void> => {
  const targets = removed.filter((asset): asset is ImageAssetType => !!asset && asset.storageKey.length > 0);
  if (targets.length === 0) return;
  await Promise.allSettled(targets.map((asset) => GcsStorageService.deleteFile({ fileId: asset.storageKey })));
};
