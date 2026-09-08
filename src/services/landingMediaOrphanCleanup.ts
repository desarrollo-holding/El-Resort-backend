import { GcsStorageService } from "./csStorage.service";

type JsonRecord = Record<string, unknown>;
type JsonLike = null | boolean | number | string | JsonLike[] | JsonRecord;

const isObjectRecord = (value: unknown): value is JsonRecord => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Recorre un árbol de `LandingMedia.json` (mismo criterio de "hoja de medio" que
 * `LandingMediaController.normalizeJsonMediaNodes`: cualquier objeto con `src` string) y junta
 * los `src` de las hojas `kind: "image"`. No hace falta filtrar video/file/svg-gif acá: sus
 * `src` tampoco matchean nada nuevo si no cambiaron, y si cambiaron su limpieza la resuelve
 * igual `deleteFile`/`extractKeyFromUrl`, sin distinción de tipo.
 */
export const collectImageSrcs = (value: JsonLike, out: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(value)) {
    for (const item of value) collectImageSrcs(item as JsonLike, out);
    return out;
  }
  if (!isObjectRecord(value)) return out;

  if (typeof value.src === "string" && value.kind === "image") {
    const trimmed = value.src.trim();
    if (trimmed) out.add(trimmed);
  }

  for (const [k, v] of Object.entries(value)) {
    if (k === "src" || k === "kind" || k === "status" || k === "width" || k === "height" || k === "variants") continue;
    collectImageSrcs(v as JsonLike, out);
  }

  return out;
};

/**
 * Compara el árbol de medios antes/después de un guardado (o antes de borrar el documento
 * entero, con `nextJson: null`) y borra del storage las imágenes que ya no están referenciadas:
 * reemplazadas o quitadas. Misma idea que la reconciliación de RoomTypeLocalSpecs
 * (`imageAssetSync.ts`), adaptada a un árbol JSON libre en vez de un array de assets: acá no
 * hay `storageKey` guardado en cada nodo, así que se deriva de la URL con
 * `GcsStorageService.extractKeyFromUrl` — el mismo mecanismo que ya usan Area/Extra.
 */
export const cleanupOrphanedLandingMedia = async (previousJson: unknown, nextJson: unknown): Promise<void> => {
  const previousSrcs = collectImageSrcs(previousJson as JsonLike);
  if (previousSrcs.size === 0) return;

  const nextSrcs = nextJson !== undefined && nextJson !== null ? collectImageSrcs(nextJson as JsonLike) : new Set<string>();

  const removedSrcs = Array.from(previousSrcs).filter((src) => !nextSrcs.has(src));
  if (removedSrcs.length === 0) return;

  const fileIds = removedSrcs
    .map((src) => GcsStorageService.extractKeyFromUrl(src))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (fileIds.length === 0) return;
  await Promise.allSettled(fileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
};
