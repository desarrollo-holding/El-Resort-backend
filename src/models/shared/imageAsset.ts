/**
 * Forma común de una imagen que pasó por el pipeline de variantes (`imageOptimizer` +
 * `GcsStorageService`). Se reutiliza en cualquier campo que muestre la imagen en más de un
 * tamaño real (hero, galería, card de grilla). Los campos que solo necesitan un tamaño fijo
 * (íconos, avatares circulares, un mapa) NO usan esto: se quedan con un `String` simple que ya
 * apunta a un WebP optimizado (perfil `avatar`), porque generar una escalera de variantes para
 * algo que nunca cambia de tamaño en pantalla es almacenamiento y tiempo de subida tirados.
 *
 * Los campos que guardan esto en Mongo se declaran `Schema.Types.Mixed` (no un subdocumento
 * tipado) a propósito: los documentos creados antes de este pipeline tienen un `String` suelto
 * en el mismo lugar, y forzar un cast a objeto rompería la lectura de esos documentos hasta que
 * corra el backfill (deliberadamente pospuesto). `normalizeImageAsset`/`normalizeImageAssetArray`
 * son la única fuente de verdad para leer estos campos: aceptan ambas formas y las
 * homogeneízan en el momento de leer, no de escribir.
 */
export type ImageVariantType = {
  width: number;
  height: number;
  format: string;
  url: string;
};

export type ImageAssetType = {
  /** Apunta a `orig.webp`: un consumidor que solo conozca `url` ya recibe la versión optimizada. */
  url: string;
  storageKey: string;
  /** Carpeta del bucket donde viven `orig.webp` y las variantes; permite borrarlas todas de una vez. */
  storagePrefix: string;
  /** Ausentes en imágenes legacy (subidas antes de este pipeline, nunca reprocesadas). */
  width?: number;
  height?: number;
  variants: ImageVariantType[];
  /**
   * El archivo original tal como estaba antes de que el backfill lo recodificara. Se conserva para
   * poder volver atrás (`npm run media:backfill -- --rollback <archivo>`) y para poder borrarlo
   * junto con la imagen: una imagen migrada guarda su original FUERA de `storagePrefix/`, así que
   * borrar solo la carpeta de variantes dejaría huérfano un archivo de varios MB.
   *
   * El sitio NUNCA los sirve. Vacíos en las imágenes subidas ya con el pipeline (no hubo original
   * previo) y en las que nunca se migraron.
   */
  legacyUrl?: string;
  legacyStorageKey?: string;
};

const isImageVariantLike = (value: unknown): value is ImageVariantType => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.url === "string" && v.url.length > 0 && typeof v.width === "number" && typeof v.height === "number" && typeof v.format === "string";
};

/**
 * Homogeneíza un campo de imagen a `ImageAssetType | null`, aceptando:
 * - un `string` (dato legacy, previo a este pipeline): se envuelve como asset "pelado" sin
 *   variantes, exactamente el mismo degradado que el documento original usa para imágenes sin
 *   escalera ("una imagen sin variants sale sin srcset").
 * - un objeto ya en la forma nueva (con o sin `variants`).
 * - cualquier otra cosa (`null`, `undefined`, forma corrupta): `null`.
 */
export const normalizeImageAsset = (value: unknown): ImageAssetType | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return { url: trimmed, storageKey: "", storagePrefix: "", variants: [] };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const v = value as Record<string, unknown>;
  if (typeof v.url !== "string" || !v.url.trim()) return null;

  return {
    url: v.url.trim(),
    storageKey: typeof v.storageKey === "string" ? v.storageKey : "",
    storagePrefix: typeof v.storagePrefix === "string" ? v.storagePrefix : "",
    width: typeof v.width === "number" && Number.isFinite(v.width) ? v.width : undefined,
    height: typeof v.height === "number" && Number.isFinite(v.height) ? v.height : undefined,
    variants: Array.isArray(v.variants) ? v.variants.filter(isImageVariantLike) : [],
    legacyUrl: typeof v.legacyUrl === "string" && v.legacyUrl.trim() ? v.legacyUrl.trim() : undefined,
    legacyStorageKey:
      typeof v.legacyStorageKey === "string" && v.legacyStorageKey.trim() ? v.legacyStorageKey.trim() : undefined,
  };
};

/** Igual que `normalizeImageAsset` pero para un array (bedrooms[].photos, extraGalleryImages, imagenes[]). */
export const normalizeImageAssetArray = (value: unknown): ImageAssetType[] => {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeImageAsset).filter((v): v is ImageAssetType => v !== null);
};
