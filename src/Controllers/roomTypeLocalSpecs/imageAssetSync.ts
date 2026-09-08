import { GcsStorageService } from "../../services/csStorage.service";
import { normalizeImageAsset, type ImageAssetType } from "../../models/shared/imageAsset";

/**
 * El dashboard sigue mandando "cuáles fotos mantener" como un array de URLs simples
 * (`keepUrls`/`photos`), exactamente como antes de este pipeline — no hace falta que
 * reenvíe el objeto completo con sus variantes. Esta función resuelve cada URL contra las
 * imágenes que YA tiene el documento (que sí conservan `variants[]`) para no perder esa
 * metadata al editar. Una URL que no matchea nada existente (raro; normalmente un dato
 * suelto pegado a mano) se conserva como asset "pelado" sin variantes, en vez de rechazarla.
 */
export const resolveKeptImageAssets = (existingAssets: ImageAssetType[], keptUrls: string[]): ImageAssetType[] => {
  const byUrl = new Map(existingAssets.map((asset) => [asset.url, asset] as const));
  return keptUrls.map((url) => byUrl.get(url) ?? normalizeImageAsset(url)).filter((asset): asset is ImageAssetType => asset !== null);
};

/** Igual que `resolveKeptImageAssets` pero para un campo de una sola imagen (`portada`, `portadaMenu`). */
export const resolveKeptSingleImageAsset = (existing: ImageAssetType | null, rawValue: string): ImageAssetType | null => {
  if (existing && existing.url === rawValue) return existing;
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

const identityOf = (asset: ImageAssetType): string => asset.storageKey || asset.url;

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
