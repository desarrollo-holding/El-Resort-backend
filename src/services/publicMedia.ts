/**
 * Reescritura de URLs de medios al RESPONDER.
 *
 * Los documentos guardan siempre la URL absoluta del bucket
 * (`https://storage.googleapis.com/<bucket>/...`). Si se define `MEDIA_PUBLIC_BASE_URL`
 * (p. ej. `https://elresort.pe/cms`), esa base reemplaza al prefijo del bucket para que el
 * navegador pida las imágenes por el MISMO ORIGEN del sitio.
 *
 * POR QUÉ VALE LA PENA
 * Pedir una imagen a `storage.googleapis.com` cuesta, por dominio y en frío, un DNS + TCP + TLS
 * antes del primer byte: unos 3 RTT, ~450 ms en el perfil móvil de Lighthouse. Sirviéndolas desde
 * el propio dominio viajan por la misma conexión HTTP/2 que ya se abrió para el HTML, y además las
 * puede cachear el borde del CDN del sitio.
 *
 * POR QUÉ AL RESPONDER Y NO EN LA BASE
 * Porque así el dominio público es una decisión de despliegue y no un dato. Borrar la variable
 * vuelve a las URLs del bucket sin migrar nada, y cambiar de CDN mañana es cambiar una variable en
 * vez de reescribir la colección. Si las URLs públicas estuvieran horneadas en los documentos,
 * cada cambio de dominio sería una migración de datos con su propio riesgo.
 *
 * CÓMO SE APLICA (y por qué no campo por campo)
 * La reescritura se hace sobre el JSON ya serializado, en un único middleware
 * (`middleware/publicMediaUrls.ts`), y no recorriendo nombres de campo conocidos. En este esquema
 * las imágenes viven en formas muy distintas —`landingmedias` es un árbol libre con hojas `src`,
 * `roomTypeLocalSpecs` tiene `portada`/`portadaMenu`/`bedrooms[].photos`/`extraGalleryImages`,
 * áreas y extras tienen `imagenes[]`, las reseñas un avatar suelto— y varios de esos campos son
 * `Schema.Types.Mixed`. Una lista de campos a reescribir sería una lista que algún día no
 * coincide con la realidad, y el síntoma sería silencioso: una imagen que sigue saliendo por el
 * bucket y nadie nota, porque funciona igual, solo más lento.
 *
 * Trabajar sobre el texto serializado es total por construcción: no hay campo que se pueda
 * olvidar. Y es seguro porque el prefijo que se busca es una URL completa con el nombre del
 * bucket: cualquier aparición dentro de una respuesta ES una URL de medios.
 */

/** Prefijo público de los objetos del bucket. Se calcula una vez: `getGcsConfigFromEnv` parsea el
 * JSON de credenciales en cada llamada y esto se consulta en cada respuesta. */
let cachedPrefix: string | null | undefined;
let cachedBase: string | null | undefined;
let cachedForBucket: string | undefined;
let cachedForBase: string | undefined;

/**
 * Lee el bucket del entorno SIN lanzar. `getGcsConfigFromEnv` tira si falta el bucket o si las
 * credenciales no son un JSON válido, y eso está bien para una subida: si no hay dónde subir, la
 * petición debe fallar. Pero esto corre en el camino de CADA respuesta, incluidas las que no tocan
 * medios, así que un entorno sin GCS configurado (un test, un dev sin credenciales) tiene que
 * seguir respondiendo con normalidad en vez de devolver 500 en todo.
 */
function bucketNameOrNull(): string | null {
  const bucket = process.env.GCS_BUCKET_RESORT;
  return bucket && bucket.trim() ? bucket.trim() : null;
}

function normalizedBase(): string | null {
  const raw = process.env.MEDIA_PUBLIC_BASE_URL;
  if (!raw || !raw.trim()) return null;
  // Sin barra final: se agrega al concatenar, para no producir `//` ni depender de cómo se escribió
  // la variable de entorno.
  return raw.trim().replace(/\/+$/, "");
}

/**
 * `{ prefix, base }` si la reescritura está activa, `null` si no. Se memoiza contra los valores de
 * entorno que la componen, de modo que cambiar una variable en un test invalida la caché sola.
 */
function rewriteConfig(): { prefix: string; base: string } | null {
  const bucket = bucketNameOrNull();
  const base = normalizedBase();

  if (cachedForBucket !== (bucket ?? undefined) || cachedForBase !== (base ?? undefined)) {
    cachedForBucket = bucket ?? undefined;
    cachedForBase = base ?? undefined;
    cachedPrefix = bucket ? `https://storage.googleapis.com/${bucket}/` : null;
    cachedBase = base;
  }

  if (!cachedPrefix || !cachedBase) return null;
  return { prefix: cachedPrefix, base: cachedBase };
}

/** ¿Está activa la reescritura? Útil para no serializar dos veces cuando no hay nada que hacer. */
export const isPublicMediaRewriteEnabled = (): boolean => rewriteConfig() !== null;

/**
 * Reescribe una URL suelta. Devuelve la entrada tal cual si la reescritura está apagada o si la
 * URL no es de este bucket (una URL de Cloudbeds, un `data:`, una ruta relativa del front).
 */
export const toPublicMediaUrl = (url: string): string => {
  const config = rewriteConfig();
  if (!config || typeof url !== "string") return url;
  if (!url.startsWith(config.prefix)) return url;
  return `${config.base}/${url.slice(config.prefix.length)}`;
};

/**
 * Reescribe todas las URLs del bucket dentro de un JSON ya serializado.
 *
 * Se opera sobre el texto y no sobre el objeto a propósito: recorrer el objeto obligaría a
 * distinguir objetos planos de `Date`, `ObjectId`, documentos de Mongoose y demás — y un walker
 * ingenuo convierte un `Date` en `{}` sin avisar. El texto serializado ya es exactamente lo que va
 * a recibir el cliente.
 *
 * El `/` no se escapa en JSON, así que el prefijo aparece literal dentro de las cadenas y un
 * `split`/`join` alcanza. No se usa una expresión regular con el prefijo interpolado porque el
 * nombre del bucket vendría del entorno sin escapar y un punto en el nombre (los buckets de GCS los
 * admiten) se volvería un comodín.
 */
export const rewriteMediaUrlsInJson = (json: string): string => {
  const config = rewriteConfig();
  if (!config || !json) return json;
  if (!json.includes(config.prefix)) return json;
  return json.split(config.prefix).join(`${config.base}/`);
};
