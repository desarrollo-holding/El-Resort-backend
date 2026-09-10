import type { MediaRef, MediaRefMode } from "./mediaRefs";

/**
 * Qué colecciones se recorren y, dentro de cada una, qué se le puede escribir a cada ubicación.
 *
 * POR QUÉ HACE FALTA ESTA TABLA SI EL RECORRIDO ES GENÉRICO
 * El descubrimiento de referencias es genérico a propósito (ver mediaRefs.ts): así no hay campo
 * que se pueda olvidar. Pero ESCRIBIR sí depende del esquema, y ahí no se puede improvisar:
 *
 *   - `beneficios.iconUrl` y `condominios.mapUrl` están declarados `type: String` en Mongoose.
 *     Escribir un objeto con `variants[]` ahí falla la validación o se guarda como
 *     "[object Object]", que rompe la página sin que ninguna prueba se queje.
 *   - `areas.imagenes[]`, `extras.imagenes[]` y los campos de `roomtypelocalspecs` son `Mixed` y
 *     sí admiten el objeto completo; de hecho `normalizeImageAsset` existe precisamente para leer
 *     indistintamente el `string` viejo y el objeto nuevo.
 *
 * De ahí los dos modos. `url-only` recodifica y reemplaza la URL —que es donde está el 90 % del
 * ahorro en bytes— pero no puede habilitar `srcset` ni guardar la marca de idempotencia, porque no
 * hay dónde. Es una limitación del esquema, no del pipeline: el día que esos campos pasen a
 * `Mixed`, se cambia el modo acá y la corrida siguiente les genera las variantes.
 */
export type CollectionRule = {
  collection: string;
  /** Modo por defecto de cualquier ubicación de esta colección. */
  defaultMode: MediaRefMode;
  /**
   * Excepciones por ruta. Se comparan contra la ruta con los índices de array normalizados a `#`
   * (`imagenes.2` → `imagenes.#`), para que una regla cubra todos los elementos del array.
   */
  modeByPath?: Record<string, MediaRefMode>;
};

export const COLLECTION_RULES: CollectionRule[] = [
  // `imagenes[]` es `[Mixed]` y se lee con `normalizeImageAssetArray`: admite el objeto completo.
  { collection: "areas", defaultMode: "asset" },
  { collection: "extras", defaultMode: "asset" },
  // `portada`, `portadaMenu`, `bedrooms[].photos[]` y `extraGalleryImages[]` son `Mixed`
  // (RoomTypeLocalSpecs.ts:72,84,89,99): admiten el objeto completo.
  {
    collection: "roomtypelocalspecs",
    defaultMode: "asset",
    modeByPath: {
      // `portada_video: { type: String }` (RoomTypeLocalSpecs.ts:93-94). El nombre engaña: NO
      // guarda un vídeo, guarda el fotograma de portada del vídeo y los tres valores reales son
      // `.jpg`. Por eso no lo salta la clasificación `video` y hay que marcarlo a mano: es una
      // imagen que sí conviene recodificar (una de ellas pesa 2,3 MB), pero en un campo que solo
      // puede guardar una cadena.
      portada_video: "url-only",
    },
  },
  // El árbol `json` es `Mixed` completo: cada hoja puede recibir `width`/`height`/`variants`, que
  // es justo lo que `readLeafImageAsset` del front ya sabe leer.
  { collection: "landingmedias", defaultMode: "asset" },
  // `iconUrl: { type: String, required: true }`.
  { collection: "beneficios", defaultMode: "url-only" },
  // `mapUrl: { type: String }`.
  { collection: "condominios", defaultMode: "url-only" },
];

/** `imagenes.2.url` → `imagenes.#.url`, para que las reglas por ruta no dependan del índice. */
export const normalizePathPattern = (path: string): string => path.replace(/(^|\.)\d+(?=\.|$)/g, "$1#");

export function modeFor(rule: CollectionRule, ref: MediaRef): MediaRefMode {
  const byPath = rule.modeByPath?.[normalizePathPattern(ref.path)];
  if (byPath) return byPath;

  // Una referencia `string` suelta en una colección `asset` sigue siendo escribible como objeto
  // solo si su contenedor es un array/objeto `Mixed`. En la práctica, en este esquema todas las
  // colecciones marcadas `asset` tienen esos campos en `Mixed`, así que el modo de la colección
  // alcanza. Si algún día se agrega un `String` a una de ellas, va en `modeByPath`.
  return rule.defaultMode;
}
