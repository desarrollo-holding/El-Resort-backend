/**
 * Con qué `Content-Type` se GUARDA en el bucket un objeto que se sube tal cual (vídeo, archivo,
 * y las excepciones SVG/GIF que no pasan por sharp).
 *
 * POR QUÉ HACE FALTA, Y POR QUÉ SOLO ROMPE EL VÍDEO
 * Hasta acá el `contentType` del objeto era, literalmente, `file.mimetype` de multer — es decir, lo
 * que declaró el navegador para esa parte del multipart. Y lo que declara el navegador sale de
 * `File.type`, que en Windows lo resuelve el REGISTRO del sistema: si la extensión no está
 * asociada (`.webm` y `.mov` muy a menudo no lo están, y `.mp4` tampoco cuando el reproductor por
 * defecto se desinstaló), `File.type` llega vacío y el navegador manda la parte como
 * `application/octet-stream`.
 *
 * `assertVideoFiles` (Controllers/roomTypeLocalSpecs/normalize.ts) ya ACEPTA ese caso a propósito,
 * justamente porque un MIME vacío no prueba nada. Pero después ese mismo valor se usaba como
 * `contentType` del objeto, así que el vídeo quedaba publicado como `application/octet-stream`. Un
 * `<video>` decide si puede reproducir POR LA CABECERA, no por los bytes: con un tipo que no es de
 * medios descarta la fuente sin intentar decodificarla, y el navegador tira exactamente
 * «NotSupportedError: The element has no supported sources».
 *
 * Las imágenes nunca sufrieron esto porque se recodifican y se guardan con `image/webp` escrito a
 * mano. El único camino que propagaba el MIME del cliente es el de objeto plano, o sea vídeo.
 *
 * LA REGLA
 * La extensión del archivo es un dato mejor que el MIME del cliente, porque viaja con el archivo y
 * no depende de cómo esté configurada la máquina del admin. Así que:
 *   - si el cliente no dijo nada útil (vacío, `application/octet-stream` y familia) → manda la
 *     extensión;
 *   - si el cliente dijo algo de la misma familia que la extensión (`video/quicktime` para `.mov`)
 *     → se respeta tal cual, que es más específico de lo que sabemos acá;
 *   - si el cliente dijo algo de OTRA familia que la extensión (un `.mp4` anunciado como
 *     `application/x-mp4`, cosa que pasa con registros de Windows retocados) → manda la extensión,
 *     porque un tipo de la familia equivocada rompe el reproductor igual que uno genérico;
 *   - si la extensión no la conocemos → se deja lo que dijo el cliente, o `application/octet-stream`
 *     si tampoco dijo nada. Adivinar un tipo de medios que no sabemos es peor que ser genérico.
 */

/** Extensión → tipo con el que se sirve. Solo lo que este pipeline puede recibir. */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  // Vídeo
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  "3gp": "video/3gpp",
  wmv: "video/x-ms-wmv",
  // Imagen que no pasa por sharp
  svg: "image/svg+xml",
  gif: "image/gif",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  avif: "image/avif",
  // Documentos de `files/`
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain; charset=utf-8",
};

/** Tipos que el cliente manda cuando en realidad no sabe cuál es: no aportan nada. */
const GENERIC_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/unknown",
  "*/*",
]);

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** Extensión en minúsculas de un nombre de archivo, o `""` si no tiene. Ignora query/fragmento
 * para poder usarse también sobre una URL o una clave de objeto. */
export const extensionOf = (name: string): string => {
  if (typeof name !== "string") return "";
  const withoutQuery = name.split(/[?#]/, 1)[0];
  const lastSegment = withoutQuery.split("/").pop() ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) return "";
  return lastSegment.slice(dotIndex + 1).toLowerCase();
};

/** Tipo que corresponde a la extensión del archivo, o `null` si no la conocemos. */
export const contentTypeByExtension = (name: string): string | null =>
  CONTENT_TYPE_BY_EXTENSION[extensionOf(name)] ?? null;

/** La parte anterior a la `/` de un tipo MIME (`video/mp4` → `video`). */
const familyOf = (mimeType: string): string => mimeType.split("/", 1)[0] ?? "";

/** ¿Este tipo es uno de los que el cliente manda cuando no sabe? */
export const isGenericContentType = (mimeType: string | undefined | null): boolean =>
  GENERIC_MIME_TYPES.has(typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "");

/**
 * Tipo con el que hay que guardar el objeto, según la regla de arriba. `reportedMimeType` es lo que
 * declaró el cliente (`file.mimetype`); puede venir vacío.
 */
export const resolveStoredContentType = (originalName: string, reportedMimeType?: string | null): string => {
  const reported = typeof reportedMimeType === "string" ? reportedMimeType.trim().toLowerCase() : "";
  const byExtension = contentTypeByExtension(originalName);

  if (!byExtension) return reported || DEFAULT_CONTENT_TYPE;
  if (isGenericContentType(reported)) return byExtension;
  return familyOf(reported) === familyOf(byExtension) ? reported : byExtension;
};

/**
 * ¿Un objeto ya guardado con este `contentType` se sirve de forma que un `<video>` lo pueda
 * reproducir? Lo usa el script de reparación (`scripts/fixMediaContentType.ts`) para decidir qué
 * objetos del bucket hay que corregir sin tocar los que ya están bien.
 */
export const storedContentTypeNeedsFix = (objectKey: string, storedContentType?: string | null): string | null => {
  const expected = contentTypeByExtension(objectKey);
  if (!expected) return null;

  const stored = typeof storedContentType === "string" ? storedContentType.trim().toLowerCase() : "";
  // Se compara sin parámetros (`; charset=...`): un `text/csv; charset=utf-8` guardado está bien.
  const storedBase = stored.split(";", 1)[0].trim();
  if (storedBase === expected.split(";", 1)[0].trim()) return null;
  if (!isGenericContentType(storedBase) && familyOf(storedBase) === familyOf(expected)) return null;

  return expected;
};
