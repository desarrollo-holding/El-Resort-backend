import { randomUUID } from "crypto";
import { Storage } from "@google-cloud/storage";
import mongoose from "mongoose";
import { getGcsConfigFromEnv } from "../../config/gcs";
import { buildVariants, InvalidImageError, type ImageProfileKey } from "../imageOptimizer";
import type { PendingItem } from "./inventory";
import type { MediaRefMode } from "./mediaRefs";

/**
 * La corrida del backfill.
 *
 * PRINCIPIO DE DISEÑO: comparte el constructor de variantes con las subidas del panel
 * (`imageOptimizer.buildVariants`). No hay una segunda implementación "para la migración" que pueda
 * divergir de la de producción; lo único propio de acá es de dónde sale el buffer (una descarga en
 * vez de un multipart) y a dónde se escribe el resultado (un `$set` en una ruta concreta).
 *
 * IDEMPOTENCIA: la marca es `storagePrefix`, nunca `variants.length` — ver `classify` en
 * mediaRefs.ts. Relanzar la corrida es siempre seguro y es la forma de repararla.
 *
 * UNA ESCRITURA POR IMAGEN: cada medio se confirma con su propio `updateOne` en cuanto termina. No
 * hay una transacción grande al final. Un corte a mitad de corrida no deja nada a medias: lo
 * confirmado está confirmado y el resto sigue pendiente.
 *
 * UNA IMAGEN ROTA NUNCA DETIENE LA CORRIDA: se anota el error en el reporte y se sigue. Con 155
 * imágenes, un original corrupto no puede impedir que se migren las otras 154.
 */

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** El `mediaKind` que usa `GcsStorageService` para las imágenes; se replica para que las carpetas
 *  del backfill queden junto a las de las subidas normales. */
const IMAGE_FOLDER = "fotosresort";

export type BackfillOutcome = "migrada" | "omitida" | "fallida";

export type BackfillRecord = {
  collection: string;
  docId: string;
  path: string;
  mode: MediaRefMode;
  outcome: BackfillOutcome;
  /** Valor exacto que había antes del `$set`. Es lo que permite revertir con precisión. */
  priorValue?: unknown;
  /** Carpeta nueva, para poder borrarla si se revierte. */
  storagePrefix?: string;
  /** Peso del archivo original: lo que bajaba CUALQUIER visitante antes. */
  bytesBefore?: number;
  /** Peso de `orig.webp`: lo que baja un escritorio grande ahora. */
  bytesOrig?: number;
  /** Peso del candidato más chico: lo que baja un teléfono ahora. */
  bytesSmallest?: number;
  /** Suma de todo lo subido (orig + variantes). Es almacenamiento, NO tráfico. */
  bytesStored?: number;
  error?: string;
};

export type BackfillReport = {
  startedAt: string;
  finishedAt?: string;
  dryRun: boolean;
  total: number;
  migradas: number;
  omitidas: number;
  fallidas: number;
  bytesBefore: number;
  bytesOrig: number;
  bytesSmallest: number;
  bytesStored: number;
  records: BackfillRecord[];
};

/** El perfil se deriva de lo que el campo puede guardar, no del archivo de entrada. */
const profileForMode = (mode: MediaRefMode): ImageProfileKey => (mode === "asset" ? "default" : "single");

function bucket() {
  const { bucket: name, credentials } = getGcsConfigFromEnv();
  return new Storage({ credentials }).bucket(name);
}

const publicUrlFor = (bucketName: string, key: string) => `https://storage.googleapis.com/${bucketName}/${key}`;

/** Clave del objeto dentro del bucket a partir de su URL pública. */
function storageKeyFromUrl(url: string, bucketName: string): string | null {
  const prefix = `https://storage.googleapis.com/${bucketName}/`;
  if (!url.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(url.slice(prefix.length));
  } catch {
    return null;
  }
}

/**
 * Descarga el original. Se baja del bucket con credenciales y no por HTTP público, para que la
 * corrida funcione igual si algún día el bucket deja de ser legible sin credenciales (que es lo que
 * debería pasar con `bills/` y compañía).
 */
async function downloadOriginal(url: string, bucketName: string): Promise<Buffer> {
  const key = storageKeyFromUrl(url, bucketName);
  if (key) {
    const [buffer] = await bucket().file(key).download();
    return buffer;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`descarga falló con HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Sube `orig.webp` + variantes a una carpeta nueva. Si falla una, borra la carpeta entera. */
async function uploadBuilt(built: Awaited<ReturnType<typeof buildVariants>>) {
  const { bucket: bucketName } = getGcsConfigFromEnv();
  const target = bucket();
  const storagePrefix = `${IMAGE_FOLDER}/${Date.now()}-${randomUUID()}`;
  const uploaded: string[] = [];

  try {
    const origKey = `${storagePrefix}/orig.webp`;
    await target.file(origKey).save(built.orig.buffer, {
      resumable: false,
      metadata: { contentType: "image/webp", cacheControl: IMMUTABLE_CACHE_CONTROL },
    });
    uploaded.push(origKey);

    const variants: { width: number; height: number; format: string; url: string }[] = [];
    for (const variant of built.variants) {
      const key = `${storagePrefix}/w${variant.width}.webp`;
      await target.file(key).save(variant.buffer, {
        resumable: false,
        metadata: { contentType: "image/webp", cacheControl: IMMUTABLE_CACHE_CONTROL },
      });
      uploaded.push(key);
      variants.push({ width: variant.width, height: variant.height, format: variant.format, url: publicUrlFor(bucketName, key) });
    }

    const bytesOrig = built.orig.buffer.length;
    const bytesStored = bytesOrig + built.variants.reduce((sum, v) => sum + v.buffer.length, 0);
    // El candidato más chico es lo que de verdad baja un teléfono. Si no hubo variantes (imagen ya
    // más angosta que 480 px, o perfil `single`), lo más chico que existe es `orig`.
    const bytesSmallest = built.variants.length
      ? Math.min(...built.variants.map((v) => v.buffer.length))
      : bytesOrig;

    return {
      storagePrefix,
      storageKey: origKey,
      url: publicUrlFor(bucketName, origKey),
      width: built.width,
      height: built.height,
      variants,
      bytesOrig,
      bytesSmallest,
      bytesStored,
    };
  } catch (error) {
    // Sin esto queda una carpeta a medias que ningún documento referencia y que nadie va a
    // encontrar jamás.
    await Promise.allSettled(uploaded.map((key) => target.file(key).delete()));
    throw error;
  }
}

export type StoredResult = {
  storagePrefix: string;
  storageKey: string;
  url: string;
  width: number;
  height: number;
  variants: { width: number; height: number; format: string; url: string }[];
  bytesOrig: number;
  bytesSmallest: number;
  bytesStored: number;
};

export async function removeStoredPrefix(storagePrefix: string): Promise<void> {
  if (!storagePrefix) return;
  await bucket().deleteFiles({ prefix: storagePrefix, force: true });
}

/**
 * Construye el `$set` para una ubicación.
 *
 * En modo `asset` se escribe el objeto completo en la ruta, conservando las claves que el
 * contenedor ya tenía (una hoja de `landingmedias` lleva `sortIndex`, `desktop_coordinates`,
 * `kind`, `status`: perderlas rompería el carrusel) y respetando qué clave guarda la URL: `url` en
 * un `ImageAssetType`, `src` en una hoja del árbol de landing.
 *
 * En modo `url-only` se escribe solo la cadena nueva, porque el campo es `String` en el esquema.
 */
export function buildSet(item: PendingItem, stored: StoredResult, priorValue: unknown) {
  if (item.mode === "url-only") {
    return { [item.path]: stored.url };
  }

  const prior = priorValue && typeof priorValue === "object" && !Array.isArray(priorValue) ? (priorValue as Record<string, unknown>) : {};
  // `leaf` guarda la URL en `src`; un `ImageAssetType` (o un string suelto que se promueve a
  // objeto) la guarda en `url`.
  const urlKey = item.shape === "leaf" ? "src" : "url";

  const next: Record<string, unknown> = {
    ...prior,
    [urlKey]: stored.url,
    storageKey: stored.storageKey,
    storagePrefix: stored.storagePrefix,
    width: stored.width,
    height: stored.height,
    variants: stored.variants,
    legacyUrl: item.url,
    legacyStorageKey: storageKeyFromUrl(item.url, getGcsConfigFromEnv().bucket) ?? "",
  };

  // Una hoja tenía la URL en `src`; si además arrastraba un `url` viejo, dejarlo sería tener dos
  // fuentes de verdad para la misma imagen.
  if (urlKey === "src") delete next.url;

  return { [item.path]: next };
}

export type RunOptions = {
  dryRun: boolean;
  /** Procesar como máximo estas ubicaciones. Útil para una primera pasada de prueba. */
  limit?: number;
  /** Restringir a una colección. */
  collection?: string;
  onProgress?: (record: BackfillRecord, index: number, total: number) => void;
};

export async function runBackfill(pending: PendingItem[], options: RunOptions): Promise<BackfillReport> {
  const { bucket: bucketName } = getGcsConfigFromEnv();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Sin conexión a MongoDB");

  let work = pending;
  if (options.collection) work = work.filter((item) => item.collection === options.collection);
  if (options.limit !== undefined) work = work.slice(0, options.limit);

  const report: BackfillReport = {
    startedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    total: work.length,
    migradas: 0,
    omitidas: 0,
    fallidas: 0,
    bytesBefore: 0,
    bytesOrig: 0,
    bytesSmallest: 0,
    bytesStored: 0,
    records: [],
  };

  for (const [index, item] of work.entries()) {
    const record: BackfillRecord = {
      collection: item.collection,
      docId: item.docId,
      path: item.path,
      mode: item.mode,
      outcome: "fallida",
    };

    try {
      // Se relee el valor actual justo antes de escribir, en vez de confiar en la foto que tomó el
      // inventario. Entre que se armó la lista y que se llega acá, alguien pudo haber subido una
      // imagen desde el panel por esa misma ruta: sobreescribirla con la migración de la anterior
      // perdería la nueva.
      // Sin `projection` a propósito: una proyección por ruta con índice de array
      // (`json.carouselImages.7`) no devuelve el elemento 7, y el valor releído salía `undefined`
      // — lo que hacía que el guardo de "cambió desde el inventario" descartara 91 de 155
      // ubicaciones perfectamente migrables. Los documentos de estas colecciones son chicos y son
      // 155 lecturas en total.
      const doc = await db.collection(item.collection).findOne({ _id: new mongoose.Types.ObjectId(item.docId) });
      const priorValue = doc ? item.path.split(".").reduce<unknown>((acc, key) => {
        if (acc === null || acc === undefined) return undefined;
        if (Array.isArray(acc)) return acc[Number(key)];
        if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
        return undefined;
      }, doc) : undefined;

      const currentUrl =
        typeof priorValue === "string"
          ? priorValue.trim()
          : priorValue && typeof priorValue === "object"
            ? String((priorValue as Record<string, unknown>).url ?? (priorValue as Record<string, unknown>).src ?? "").trim()
            : "";

      if (currentUrl !== item.url) {
        record.outcome = "omitida";
        record.error = "el valor cambió desde que se armó el inventario";
        report.omitidas += 1;
        report.records.push(record);
        options.onProgress?.(record, index, work.length);
        continue;
      }

      record.priorValue = priorValue;

      if (options.dryRun) {
        // El dry-run mide el peso actual y no descarga ni codifica nada: responde "¿cuánto voy a
        // ahorrar?" sin tocar ni el bucket ni la base.
        const head = await fetch(item.url, { method: "HEAD", signal: AbortSignal.timeout(15_000) }).catch(() => null);
        record.bytesBefore = head?.ok ? Number(head.headers.get("content-length") || 0) : 0;
        report.bytesBefore += record.bytesBefore;
        record.outcome = "migrada";
        report.migradas += 1;
        report.records.push(record);
        options.onProgress?.(record, index, work.length);
        continue;
      }

      const buffer = await downloadOriginal(item.url, bucketName);
      record.bytesBefore = buffer.length;

      const built = await buildVariants(buffer, profileForMode(item.mode));
      const stored = await uploadBuilt(built);
      record.storagePrefix = stored.storagePrefix;
      record.bytesOrig = stored.bytesOrig;
      record.bytesSmallest = stored.bytesSmallest;
      record.bytesStored = stored.bytesStored;

      try {
        // El orden subir → `$set` es el correcto: así nunca existe un documento que apunte a un
        // archivo que no existe.
        const result = await db
          .collection(item.collection)
          .updateOne({ _id: new mongoose.Types.ObjectId(item.docId) }, { $set: buildSet(item, stored, priorValue) });
        if (result.matchedCount !== 1) throw new Error("el documento ya no existe");
      } catch (error) {
        // Pero si el `$set` no llega, la carpeta recién subida no la referencia NINGÚN documento y
        // cada reintento crearía otra con otro `<ts>-<uuid>`. Se limpia acá; el medio queda
        // pendiente y la corrida siguiente lo rehace.
        await removeStoredPrefix(stored.storagePrefix).catch(() => undefined);
        throw error;
      }

      report.bytesBefore += record.bytesBefore;
      report.bytesOrig += stored.bytesOrig;
      report.bytesSmallest += stored.bytesSmallest;
      report.bytesStored += stored.bytesStored;
      record.outcome = "migrada";
      report.migradas += 1;
    } catch (error) {
      record.outcome = "fallida";
      record.error =
        error instanceof InvalidImageError
          ? `imagen inválida: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      report.fallidas += 1;
    }

    report.records.push(record);
    options.onProgress?.(record, index, work.length);
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

/**
 * Revierte una corrida a partir de su reporte: devuelve cada ruta al valor exacto que tenía y borra
 * la carpeta de variantes que se había subido.
 *
 * Se revierte ruta por ruta con el valor registrado, y NO restaurando el documento entero: si
 * alguien editó otros campos del mismo documento después de la corrida, restaurar el documento
 * completo le borraría esos cambios sin avisar.
 */
export async function rollbackReport(report: BackfillReport, options: { deleteUploads: boolean }) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Sin conexión a MongoDB");

  let restored = 0;
  let failed = 0;

  for (const record of report.records) {
    if (record.outcome !== "migrada" || record.priorValue === undefined) continue;
    try {
      await db
        .collection(record.collection)
        .updateOne({ _id: new mongoose.Types.ObjectId(record.docId) }, { $set: { [record.path]: record.priorValue } });
      if (options.deleteUploads && record.storagePrefix) {
        await removeStoredPrefix(record.storagePrefix).catch(() => undefined);
      }
      restored += 1;
    } catch {
      failed += 1;
    }
  }

  return { restored, failed };
}
