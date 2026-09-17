/**
 * Configuración de Google Cloud Storage, y el único sitio donde se decide en qué bucket se escribe.
 *
 * POR QUÉ EL BUCKET DE DESTINO ES UNA CONSTANTE Y NO SOLO UNA VARIABLE DE ENTORNO
 * Durante meses los medios del sitio se partieron entre DOS buckets sin que nadie lo notara: el
 * `.env` de este repo decía `greendreams_bucket` y el de Railway decía `marketing_gallery`, así que
 * cada subida acababa en uno u otro según desde dónde corriera el backend. El resultado fueron 601
 * referencias repartidas, y ninguna señal de que algo iba mal — las dos mitades funcionaban.
 *
 * Un valor que tiene que ser el MISMO en todos los entornos no es configuración: es una constante
 * que da la casualidad de que se lee del entorno. Dejarlo solo en `.env` convierte un error de
 * configuración en una divergencia silenciosa. Por eso el valor correcto vive acá, y el entorno
 * solo puede confirmarlo.
 */

/** Único bucket donde este servicio ESCRIBE. Cambiarlo es una migración, no un ajuste. */
export const BUCKET_DESTINO = "marketing_gallery";

/**
 * Buckets que solo se LEEN: contienen medios de antes de la unificación. Se configura con
 * `GCS_BUCKET_RESORT_LEGACY` (lista separada por comas) y vacío significa "migración consolidada".
 * Nunca se escribe ni se borra en ellos.
 */
const leerLegacy = (): string[] =>
  (process.env.GCS_BUCKET_RESORT_LEGACY || "")
    .split(",")
    .map((nombre) => nombre.trim())
    .filter(Boolean);

export type GcsConfig = {
  /** Bucket de escritura. Siempre `BUCKET_DESTINO`. */
  bucket: string;
  /** Buckets de solo lectura, para migraciones. Puede estar vacío. */
  legacy: string[];
  credentials: Record<string, unknown>;
};

export const getGcsConfigFromEnv = (): GcsConfig => {
  const bucket = process.env.GCS_BUCKET_RESORT;
  const rawCredentials = process.env.GOOGLE_CLOUD_STORAGE_CREDENTIALS;

  if (!bucket) throw new Error("GCS_BUCKET_RESORT no está definido");
  if (!rawCredentials) throw new Error("GOOGLE_CLOUD_STORAGE_CREDENTIALS no está definido");

  const legacy = leerLegacy();

  // Se comprueba ANTES que las credenciales: arrancar apuntando al bucket equivocado es peor que
  // no arrancar, porque el proceso funciona y va escribiendo donde no debe durante días.
  if (legacy.includes(bucket)) {
    throw new Error(
      `GCS_BUCKET_RESORT=${bucket} es un bucket LEGACY (solo lectura). ` +
        `El destino de escritura es "${BUCKET_DESTINO}". Corregí la variable en este entorno.`
    );
  }

  if (bucket !== BUCKET_DESTINO && process.env.GCS_BUCKET_RESORT_OVERRIDE !== "1") {
    throw new Error(
      `GCS_BUCKET_RESORT=${bucket} no coincide con el destino esperado "${BUCKET_DESTINO}". ` +
        `Si es a propósito (un bucket de pruebas), poné GCS_BUCKET_RESORT_OVERRIDE=1.`
    );
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(rawCredentials);
  } catch {
    throw new Error("GOOGLE_CLOUD_STORAGE_CREDENTIALS no es un JSON válido");
  }

  return { bucket, legacy, credentials };
};

/**
 * ¿Esta URL apunta a un bucket que este servicio conoce? Devuelve el nombre del bucket, o `null`
 * si la URL es de otro sitio (Cloudbeds, Cloudinary, un `data:`, una ruta relativa del front).
 *
 * Existe para que nadie vuelva a decidir "esto es nuestro" comparando prefijos a mano: esa
 * comparación estaba repetida en cuatro archivos y cada copia asumía UN bucket.
 */
export const bucketDeUrl = (url: string): string | null => {
  if (typeof url !== "string") return null;
  const prefijo = "https://storage.googleapis.com/";
  if (!url.startsWith(prefijo)) return null;
  const resto = url.slice(prefijo.length);
  const barra = resto.indexOf("/");
  return barra > 0 ? resto.slice(0, barra) : null;
};

/** Línea para el log de arranque: un bucket equivocado se ve en el deploy sin pedírselo a nadie. */
export const resumenDeMedios = (): string => {
  const legacy = leerLegacy();
  return (
    `[media] bucket=${process.env.GCS_BUCKET_RESORT ?? "(sin definir)"}` +
    ` proxy=${process.env.MEDIA_PUBLIC_BASE_URL || "(apagado)"}` +
    (legacy.length ? ` legacy=${legacy.join(",")}(solo lectura)` : " legacy=(ninguno)")
  );
};
