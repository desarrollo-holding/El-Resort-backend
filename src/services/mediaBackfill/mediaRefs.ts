/**
 * Descubrimiento y clasificación de referencias de medios dentro de los documentos.
 *
 * Es la pieza compartida entre el inventario (solo lectura) y el backfill: una sola
 * implementación, para que no haya una segunda "para la migración" que pueda divergir de la que
 * decide qué está migrado.
 *
 * POR QUÉ UN RECORRIDO GENÉRICO Y NO UNA LISTA DE CAMPOS
 * Las imágenes de este esquema viven en formas y profundidades muy distintas: `areas.imagenes[]` y
 * `extras.imagenes[]` admiten `string | ImageAsset`; `roomtypelocalspecs` tiene `portada`,
 * `portadaMenu`, `bedrooms[].photos[]` y `extraGalleryImages[]`; `landingmedias.json` es un árbol
 * libre cuyas hojas son `{ src, kind, status }`; y `beneficios.iconUrl` y `condominios.mapUrl` son
 * `String` planos. Varios de esos campos son `Schema.Types.Mixed`. Una lista de campos sería una
 * lista que algún día no coincide, y el síntoma es silencioso: una imagen que sigue pesando 3 MB y
 * nadie se enteró.
 */

/** Formas en las que aparece una referencia de medio, y qué se puede escribir en cada una. */
export type MediaRefShape =
  /** El valor es un `string` suelto (`imagenes[2]`, `iconUrl`). Se puede reemplazar por un objeto
   *  solo si el esquema del campo lo admite; ver `MediaRefMode`. */
  | "string"
  /** Objeto con la URL en `url` (`ImageAssetType`: portada, imagenes[], photos[]). */
  | "asset"
  /** Hoja del árbol de `landingmedias`, con la URL en `src` y no en `url`. */
  | "leaf";

/**
 * Qué se le puede escribir a esta ubicación.
 *
 * - `asset`: el campo admite un objeto, así que recibe el juego completo (`url` + `width`/`height`
 *   + `variants[]` + los punteros `legacy*`). Es el que de verdad habilita `srcset`.
 * - `url-only`: el campo es un `String` en el esquema de Mongoose (`beneficios.iconUrl`,
 *   `condominios.mapUrl`). Escribir un objeto ahí fallaría la validación o se castearía a
 *   `"[object Object]"`. Se recodifica la imagen y se reemplaza SOLO la URL: sin variantes, porque
 *   no hay dónde guardarlas, y sin `legacy*`, porque tampoco hay dónde. La reversión de estas
 *   ubicaciones depende del respaldo del documento que toma la corrida.
 */
export type MediaRefMode = "asset" | "url-only";

export type MediaClassification =
  /** Ya pasó por el pipeline: tiene `storagePrefix` y `storageKey` apunta a su `orig.webp`. */
  | "migrada"
  /** Falta migrar. */
  | "pendiente"
  /** Alguien revirtió: hay `storagePrefix` pero la URL ya no apunta al `orig.webp`. */
  | "revertida"
  /** Vídeo: no se recodifica (es otro proyecto: otra herramienta, otros tiempos). */
  | "video"
  /** No es del bucket: foto de Cloudbeds, asset local del front, `data:`. No es nuestra. */
  | "externa"
  /** Migrada en modo `url-only`: se recodificó pero el campo no puede guardar la marca. */
  | "sin-marca";

export type MediaRef = {
  /** Ruta con puntos para el `$set` de Mongo, p. ej. `json.sections.hero.src` o `imagenes.2`. */
  path: string;
  shape: MediaRefShape;
  classification: MediaClassification;
  /** URL actual del medio. */
  url: string;
  /** El objeto contenedor, cuando `shape` no es `string`. */
  container?: Record<string, unknown>;
};

const VIDEO_EXTENSION_RE = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i;

/** Extensión reconocible de imagen. No se usa para VALIDAR (eso solo lo hace decodificar), sino
 *  para no intentar recodificar un PDF de una factura que estuviera referenciado por error. */
const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?|heic|heif)(\?|$)/i;

export const bucketUrlPrefix = (bucket: string): string => `https://storage.googleapis.com/${bucket}/`;

/**
 * Clasifica un valor. `storagePrefix` es la ÚNICA marca de "ya se generaron variantes", nunca
 * `variants.length`: una imagen más angosta que el candidato menor (480 px) pasa por todo el
 * pipeline y termina con `variants: []` estando perfectamente migrada. Si la condición fuera
 * `variants.length > 0`, esa imagen se volvería a descargar, recodificar y subir en CADA corrida,
 * para siempre, dejando una carpeta huérfana cada vez.
 */
function classify(url: string, container: Record<string, unknown> | undefined, prefix: string): MediaClassification {
  if (VIDEO_EXTENSION_RE.test(url)) return "video";
  if (!url.startsWith(prefix)) return "externa";

  const storagePrefix = typeof container?.storagePrefix === "string" ? container.storagePrefix : "";
  if (!storagePrefix) {
    // Sin contenedor donde guardar la marca (un `string` suelto), la única señal de que ya se
    // recodificó es que la URL apunte a un `orig.webp` de una carpeta del pipeline.
    if (!container && /\/orig\.webp(\?|$)/.test(url)) return "sin-marca";
    return "pendiente";
  }

  const storageKey = typeof container?.storageKey === "string" ? container.storageKey : "";
  return storageKey === `${storagePrefix}/orig.webp` ? "migrada" : "revertida";
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  // Los tipos de BSON (ObjectId, Binary, Decimal128) llevan `_bsontype`; recorrerlos no aporta
  // nada y sus claves internas no son datos del documento.
  (value as { _bsontype?: unknown })._bsontype === undefined;

const MAX_DEPTH = 24;

/** Claves que nunca contienen medios y que solo añadirían ruido al recorrido. */
const SKIP_KEYS = new Set(["_id", "__v", "createdAt", "updatedAt"]);

/**
 * Recorre un documento y devuelve todas las referencias de medios que encuentra.
 *
 * Cuando un valor es un objeto con URL (`asset` o `leaf`), se emite ESE objeto y NO se vuelve a
 * emitir su string interno: si se emitieran los dos, la misma imagen aparecería dos veces y el
 * backfill la procesaría dos veces (una de ellas escribiendo en una ruta que ya no existe). Sí se
 * sigue recorriendo hacia dentro, porque un asset puede contener `variants[]` y una hoja de
 * `landingmedias` puede tener hijos.
 */
export function collectMediaRefs(doc: Record<string, unknown>, bucket: string): MediaRef[] {
  const prefix = bucketUrlPrefix(bucket);
  const out: MediaRef[] = [];

  const visit = (node: unknown, path: string, depth: number, insideVariants: boolean): void => {
    if (depth > MAX_DEPTH || node === null || node === undefined) return;

    if (typeof node === "string") {
      const url = node.trim();
      if (!url) return;
      // Las URLs de dentro de `variants[]` son derivados que el pipeline ya generó: no son
      // ubicaciones a migrar, son su resultado.
      if (insideVariants) return;
      if (!url.startsWith(prefix) && !VIDEO_EXTENSION_RE.test(url)) return;
      if (url.startsWith(prefix) && !IMAGE_EXTENSION_RE.test(url) && !VIDEO_EXTENSION_RE.test(url)) return;
      out.push({ path, shape: "string", classification: classify(url, undefined, prefix), url });
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, path ? `${path}.${index}` : String(index), depth + 1, insideVariants));
      return;
    }

    if (!isPlainObject(node)) return;

    const rawUrl = typeof node.url === "string" ? node.url.trim() : "";
    const rawSrc = typeof node.src === "string" ? node.src.trim() : "";
    const own = rawUrl || rawSrc;
    const urlKey = rawUrl ? "url" : "src";

    if (own && !insideVariants) {
      out.push({
        path,
        shape: rawUrl ? "asset" : "leaf",
        classification: classify(own, node, prefix),
        url: own,
        container: node,
      });
    }

    for (const [key, value] of Object.entries(node)) {
      if (SKIP_KEYS.has(key)) continue;
      // La URL propia del contenedor ya se emitió arriba: no volver a entrar por ella.
      if (own && key === urlKey) continue;
      visit(value, path ? `${path}.${key}` : key, depth + 1, insideVariants || key === "variants");
    }
  };

  visit(doc, "", 0, false);
  return out;
}

/** ¿Esta referencia es candidata a recodificarse en esta corrida? */
export const isPending = (ref: MediaRef): boolean => ref.classification === "pendiente";
