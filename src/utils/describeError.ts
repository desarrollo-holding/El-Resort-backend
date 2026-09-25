/**
 * Traduce CUALQUIER error del backend a un mensaje que el administrador pueda leer y accionar.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * Antes, subir un vídeo de 40 MB al dashboard devolvía un 500 con HTML de Express: ni el admin
 * sabía que el problema era el tamaño, ni el desarrollador sabía dónde mirar. Lo mismo con Mongo
 * caído, credenciales de GCS mal puestas o una variable de entorno olvidada en Railway: todo
 * terminaba como "Error interno del servidor".
 *
 * La regla es: un error SIEMPRE dice tres cosas.
 *   - `message`: qué pasó, en español y sin jerga (lo que ve el admin).
 *   - `hint`:    qué revisar o cambiar para arreglarlo (variable de entorno, formato, tamaño…).
 *   - `detail`:  el mensaje técnico original, para el desarrollador.
 *
 * Si un error no encaja en ningún caso conocido NO se esconde: se devuelve su mensaje real con el
 * nombre de la clase y el código, que es infinitamente más útil que "Error interno del servidor".
 */

export type DescribedError = {
  status: number;
  /** Código estable, en MAYÚSCULAS, para que el frontend pueda reaccionar sin parsear texto. */
  code: string;
  /** Mensaje para el administrador, en español. */
  message: string;
  /** Mensaje técnico original (clase, código, texto crudo). */
  detail?: string;
  /** Qué revisar o cambiar para que deje de pasar. */
  hint?: string;
};

export type DescribeErrorOptions = {
  /** Texto de la operación en curso, p. ej. "Error al crear el extra". Se antepone al mensaje. */
  context?: string;
  /** Límites de subida vigentes en la ruta, para poder decir el máximo exacto en MB. */
  uploadLimits?: { fileSizeBytes?: number; filesLimit?: number };
};

const MB = 1024 * 1024;

/** "20 MB", "1.5 MB", "850 KB" — sin decimales inútiles. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "desconocido";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / MB;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const message = asRecord(error).message;
  return typeof message === "string" ? message : "";
};

/** Etiqueta técnica: "MulterError(LIMIT_FILE_SIZE): File too large". */
const technicalDetail = (error: unknown): string => {
  const record = asRecord(error);
  const name = error instanceof Error ? error.name : typeof error;
  const code = record.code;
  const codePart = code === undefined || code === null || code === "" ? "" : `(${String(code)})`;
  const text = errorText(error) || String(error);
  return `${name}${codePart}: ${text}`.trim();
};

const includesAny = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

/**
 * Nombre legible del campo multipart: `mediaFiles[testimonialSection.video]` → «testimonialSection.video».
 * El admin no tiene por qué saber cómo se llaman los campos del formulario, pero saber CUÁL de los
 * archivos falló es la mitad de la solución cuando sube varios a la vez.
 */
const readableFieldName = (field: unknown): string | null => {
  const raw = typeof field === "string" ? field.trim() : "";
  if (!raw) return null;
  const inner = raw.match(/\[([^\]]+)\]/);
  const name = (inner?.[1] ?? raw).trim();
  return name.length ? name : null;
};

/** Los errores de subida de multer: el caso más frecuente y el que más confundía. */
const describeMulterError = (
  error: unknown,
  options: DescribeErrorOptions
): DescribedError | null => {
  const record = asRecord(error);
  const isMulter =
    (error instanceof Error && error.name === "MulterError") ||
    (typeof record.code === "string" && String(record.code).startsWith("LIMIT_"));
  if (!isMulter) return null;

  const code = String(record.code ?? "");
  const field = readableFieldName(record.field);
  const donde = field ? ` («${field}»)` : "";
  const maxBytes = options.uploadLimits?.fileSizeBytes;
  const maxLabel = typeof maxBytes === "number" ? formatBytes(maxBytes) : null;
  const filesLimit = options.uploadLimits?.filesLimit;

  switch (code) {
    case "LIMIT_FILE_SIZE":
      return {
        status: 413,
        code: "UPLOAD_FILE_TOO_LARGE",
        message: maxLabel
          ? `El archivo${donde} supera el tamaño máximo permitido de ${maxLabel}. Súbelo comprimido o más ligero.`
          : `El archivo${donde} supera el tamaño máximo permitido.`,
        detail: technicalDetail(error),
        hint: maxLabel
          ? `El máximo por archivo en esta ruta es ${maxLabel}. Para vídeos, comprímelo (por ejemplo a WebM, o MP4 con menos bitrate) o sube el límite con la variable de entorno MAX_UPLOAD_FILE_SIZE_MB en el servidor y reinícialo.`
          : "Comprime el archivo o sube el límite con la variable de entorno MAX_UPLOAD_FILE_SIZE_MB en el servidor.",
      };
    case "LIMIT_FILE_COUNT":
      return {
        status: 413,
        code: "UPLOAD_TOO_MANY_FILES",
        message: filesLimit
          ? `Enviaste demasiados archivos de una vez: el máximo por guardado es ${filesLimit}.`
          : "Enviaste demasiados archivos de una vez.",
        detail: technicalDetail(error),
        hint: "Guarda los cambios en tandas más pequeñas (menos archivos nuevos por guardado).",
      };
    case "LIMIT_UNEXPECTED_FILE":
      return {
        status: 400,
        code: "UPLOAD_UNEXPECTED_FIELD",
        message: `El servidor no esperaba el archivo${donde} en este formulario.`,
        detail: technicalDetail(error),
        hint: "Suele pasar si se supera el número de archivos permitidos en ese campo, o si el frontend envía un campo que la ruta no declara. Revisa el upload.array/upload.any de la ruta en src/Routes.",
      };
    case "LIMIT_PART_COUNT":
      return {
        status: 413,
        code: "UPLOAD_TOO_MANY_PARTS",
        message: "El formulario tiene demasiadas partes (campos + archivos) para una sola petición.",
        detail: technicalDetail(error),
        hint: "Divide el guardado en varios pasos.",
      };
    case "LIMIT_FIELD_KEY":
    case "LIMIT_FIELD_VALUE":
    case "LIMIT_FIELD_COUNT":
      return {
        status: 413,
        code: "UPLOAD_FIELD_TOO_LARGE",
        message: "Uno de los campos del formulario es demasiado grande para enviarlo.",
        detail: technicalDetail(error),
        hint: "Suele ser un texto larguísimo pegado en el editor. Acórtalo o divídelo.",
      };
    default:
      return {
        status: 400,
        code: "UPLOAD_FAILED",
        message: `No se pudieron procesar los archivos adjuntos${donde}.`,
        detail: technicalDetail(error),
        hint: "Revisa formato y tamaño de los archivos seleccionados.",
      };
  }
};

/** Errores que genera `express.json()` / `urlencoded()` antes de llegar al controlador. */
const describeBodyParserError = (error: unknown): DescribedError | null => {
  const type = asRecord(error).type;
  if (type === "entity.too.large") {
    return {
      status: 413,
      code: "BODY_TOO_LARGE",
      message:
        "El contenido enviado es demasiado grande (el límite del cuerpo JSON del servidor es 10 MB).",
      detail: technicalDetail(error),
      hint: "Si es texto del editor, acórtalo. Si son imágenes incrustadas en base64 dentro del JSON, súbelas como archivo en lugar de incrustarlas. El límite se cambia en src/app.ts, en express.json({ limit }).",
    };
  }
  if (type === "entity.parse.failed") {
    return {
      status: 400,
      code: "INVALID_JSON",
      message: "JSON inválido (revisa comas finales y comillas dobles).",
      detail: technicalDetail(error),
      hint: "El cuerpo de la petición no es JSON válido. Si lo escribiste a mano, valida el texto antes de enviarlo.",
    };
  }
  return null;
};

/** Errores de Mongo / Mongoose: validación, casteo, duplicados y caída de conexión. */
const describeMongoError = (error: unknown): DescribedError | null => {
  const record = asRecord(error);
  const name = error instanceof Error ? error.name : "";

  if (record.code === 11000 || record.code === 11001) {
    const keys = Object.keys(asRecord(record.keyValue));
    const campos = keys.length ? ` (${keys.join(", ")})` : "";
    return {
      status: 409,
      code: "DUPLICATE_KEY",
      message: `Ya existe un registro con ese mismo valor único${campos}.`,
      detail: technicalDetail(error),
      hint: "Cambia el valor duplicado (nombre, identificador o slug) o edita el registro que ya existe en vez de crear otro.",
    };
  }

  if (name === "ValidationError") {
    const errors = asRecord(record.errors);
    const detalles = Object.entries(errors)
      .map(([path, value]) => `${path}: ${errorText(value) || "valor inválido"}`)
      .slice(0, 8);
    return {
      status: 400,
      code: "VALIDATION_ERROR",
      message: detalles.length
        ? `Hay campos con valores inválidos — ${detalles.join(" | ")}`
        : "Hay campos con valores inválidos.",
      detail: technicalDetail(error),
      hint: "Completa o corrige los campos indicados antes de guardar.",
    };
  }

  if (name === "CastError") {
    const path = typeof record.path === "string" ? record.path : "un campo";
    const value = "value" in record ? String(record.value) : "";
    return {
      status: 400,
      code: "INVALID_VALUE",
      message: `El valor «${value}» no es válido para el campo «${path}».`,
      detail: technicalDetail(error),
      hint: "Comprueba que los identificadores sean los de la base de datos y que los números o fechas tengan el formato correcto.",
    };
  }

  if (
    name === "MongooseServerSelectionError" ||
    name === "MongoNetworkError" ||
    name === "MongoServerSelectionError" ||
    name === "MongoNotConnectedError"
  ) {
    return {
      status: 503,
      code: "DATABASE_UNAVAILABLE",
      message: "No hay conexión con la base de datos, así que no se pudo guardar ni leer nada.",
      detail: technicalDetail(error),
      hint: "Revisa la variable DATABASE_URL del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor esté permitida en Network Access de Atlas.",
    };
  }

  return null;
};

/** Errores de Google Cloud Storage: donde acaban todas las fotos y vídeos. */
const describeStorageError = (error: unknown): DescribedError | null => {
  const text = errorText(error);
  const lower = text.toLowerCase();
  const record = asRecord(error);

  if (
    includesAny(lower, [
      "could not load the default credentials",
      "error:0909006c",
      "invalid_grant",
      "decoder routines",
    ])
  ) {
    return {
      status: 500,
      code: "STORAGE_CREDENTIALS_INVALID",
      message:
        "El servidor no puede autenticarse contra Google Cloud Storage, por eso no se guardan las imágenes ni los vídeos.",
      detail: technicalDetail(error),
      hint: "Revisa las credenciales de GCS en las variables de entorno (la clave privada debe conservar los saltos de línea) y que la cuenta de servicio siga activa.",
    };
  }

  if (
    includesAny(lower, ["does not have storage.objects", "permission", "forbidden"]) &&
    includesAny(lower, ["storage", "bucket", "gcs"])
  ) {
    return {
      status: 502,
      code: "STORAGE_PERMISSION_DENIED",
      message:
        "Google Cloud Storage rechazó la operación por permisos: el archivo no se pudo guardar o borrar.",
      detail: technicalDetail(error),
      hint: "La cuenta de servicio necesita el rol «Storage Object Admin» sobre el bucket configurado. Revísalo en IAM del proyecto de Google Cloud.",
    };
  }

  if (includesAny(lower, ["specified bucket does not exist", "no such bucket"])) {
    return {
      status: 502,
      code: "STORAGE_BUCKET_NOT_FOUND",
      message: "El bucket de almacenamiento configurado no existe.",
      detail: technicalDetail(error),
      hint: "Revisa la variable de entorno del bucket de GCS: el nombre no coincide con ningún bucket del proyecto.",
    };
  }

  if (record.name === "ApiError" || includesAny(lower, ["googleapis.com", "storage.googleapis"])) {
    return {
      status: 502,
      code: "STORAGE_ERROR",
      message: "Google Cloud Storage falló al procesar el archivo.",
      detail: technicalDetail(error),
      hint: "Reintenta en unos segundos. Si se repite, revisa la configuración de GCS (bucket y credenciales) y el estado del servicio.",
    };
  }

  return null;
};

/** Errores de `sharp` al procesar una imagen que en realidad no lo es (o está corrupta). */
const describeImageProcessingError = (error: unknown): DescribedError | null => {
  const lower = errorText(error).toLowerCase();
  if (
    includesAny(lower, [
      "unsupported image format",
      "input buffer contains",
      "input file contains",
      "vipsjpeg",
      "vipspng",
      "premature end of",
      "corrupt",
    ])
  ) {
    return {
      status: 400,
      code: "INVALID_IMAGE_FILE",
      message: "El archivo no es una imagen válida o está dañado, así que no se pudo procesar.",
      detail: technicalDetail(error),
      hint: "Ábrelo y vuelve a exportarlo como JPG, PNG o WebP. Ojo con los archivos renombrados a mano (un .heic renombrado a .jpg sigue siendo HEIC) y con las descargas incompletas.",
    };
  }
  return null;
};

/** Vídeo en HEVC rechazado al subirlo (`UnsupportedVideoCodecError`, services/videoCodec.ts). */
const describeVideoCodecError = (error: unknown): DescribedError | null => {
  if (!(error instanceof Error) || error.name !== "UnsupportedVideoCodecError") return null;
  const fileName = asRecord(error).fileName;
  const cual = typeof fileName === "string" && fileName.trim() ? ` «${fileName.trim()}»` : "";
  return {
    status: 415,
    code: "UNSUPPORTED_VIDEO_CODEC",
    message: `El vídeo${cual} está en formato HEVC (H.265): en muchos equipos se oiría el audio pero la imagen quedaría en negro, así que no se subió.`,
    detail: technicalDetail(error),
    hint: "Vuelve a exportarlo como MP4 en H.264 y súbelo de nuevo (con HandBrake sirve el preset «Fast 1080p30» con «Web Optimized» marcado). Para que el iPhone grabe así desde el inicio: Ajustes → Cámara → Formatos → «Más compatible».",
  };
};

/** Variables de entorno ausentes: el caso "funciona en local y no en producción". */
const describeConfigurationError = (error: unknown): DescribedError | null => {
  const text = errorText(error);
  const lower = text.toLowerCase();
  if (
    includesAny(lower, [
      "no está definido",
      "no esta definido",
      "no configurada",
      "no configurado",
      "missing env",
      "falta la variable",
    ])
  ) {
    const variable = text.match(/\b([A-Z][A-Z0-9_]{3,})\b/)?.[1];
    return {
      status: 500,
      code: "SERVER_MISCONFIGURED",
      message: variable
        ? `Falta configuración en el servidor: la variable de entorno ${variable} no está puesta.`
        : "Falta configuración en el servidor (una variable de entorno no está puesta).",
      detail: technicalDetail(error),
      hint: variable
        ? `Añade ${variable} en las variables de entorno del servidor (en Railway, pestaña Variables) y reinicia el servicio. En .env.example está documentada.`
        : "Compara las variables del servidor con .env.example y reinicia el servicio.",
    };
  }
  return null;
};

/** Servicios externos caídos o inalcanzables (Cloudbeds, Izipay, Brevo, Gemini…). */
const describeNetworkError = (error: unknown): DescribedError | null => {
  const record = asRecord(error);
  const code = typeof record.code === "string" ? record.code : "";
  const host = typeof record.hostname === "string" ? record.hostname : "";
  const donde = host ? ` (${host})` : "";

  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      status: 502,
      code: "UPSTREAM_UNREACHABLE",
      message: `No se pudo conectar con un servicio externo${donde}.`,
      detail: technicalDetail(error),
      hint: "Revisa que la URL del servicio en las variables de entorno sea correcta y que el servicio esté en pie. Si acabas de cambiar un dominio, puede ser DNS.",
    };
  }

  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNABORTED" || code === "EPIPE") {
    return {
      status: 504,
      code: "UPSTREAM_TIMEOUT",
      message: `La conexión con un servicio externo se cortó o tardó demasiado${donde}.`,
      detail: technicalDetail(error),
      hint: "Suele ser temporal: reintenta. Si ocurre siempre al subir archivos grandes, el archivo tarda más de lo que aguanta el proxy: súbelo más ligero.",
    };
  }

  return null;
};

/** Token de sesión del dashboard caducado o inválido. */
const describeAuthError = (error: unknown): DescribedError | null => {
  const name = error instanceof Error ? error.name : "";
  if (name === "TokenExpiredError") {
    return {
      status: 401,
      code: "SESSION_EXPIRED",
      message: "Tu sesión caducó. Vuelve a iniciar sesión para seguir editando.",
      detail: technicalDetail(error),
      hint: "Los cambios sin guardar se pierden al recargar: copia los textos largos antes de volver a entrar.",
    };
  }
  if (name === "JsonWebTokenError" || name === "NotBeforeError") {
    return {
      status: 401,
      code: "INVALID_TOKEN",
      message: "La sesión no es válida. Cierra sesión y vuelve a entrar.",
      detail: technicalDetail(error),
      hint: "Si le pasa a todos los usuarios a la vez, es que cambió JWT_SECRET en el servidor: eso invalida todos los tokens anteriores.",
    };
  }
  return null;
};

/**
 * Errores que el propio código lanza con `toHttpError(4xx, "mensaje")`: el mensaje ya está
 * escrito para el admin, así que se respeta tal cual y no se sustituye por uno genérico.
 */
const describeIntentionalHttpError = (error: unknown): DescribedError | null => {
  const status = asRecord(error).status;
  if (typeof status !== "number" || status < 400 || status >= 500) return null;
  const message = errorText(error).trim();
  if (!message) return null;
  return {
    status,
    code: "REQUEST_REJECTED",
    message,
    detail: technicalDetail(error),
  };
};

const prefixWithContext = (message: string, context?: string): string => {
  const ctx = (context ?? "").trim().replace(/[.:]\s*$/, "");
  if (!ctx) return message;
  // Evita "Error al crear el extra: Error al crear el extra" si el mensaje ya lo dice.
  if (message.toLowerCase().startsWith(ctx.toLowerCase())) return message;
  return `${ctx}: ${message}`;
};

/**
 * Clasifica un error desconocido. Nunca devuelve "Error interno del servidor" a secas: si no
 * reconoce la causa, devuelve el mensaje real del error con su clase y código.
 */
export const describeError = (
  error: unknown,
  options: DescribeErrorOptions = {}
): DescribedError => {
  const described =
    describeMulterError(error, options) ??
    describeBodyParserError(error) ??
    // Antes que los que buscan palabras en el texto: el mensaje lleva el nombre del archivo.
    describeVideoCodecError(error) ??
    describeIntentionalHttpError(error) ??
    describeMongoError(error) ??
    describeStorageError(error) ??
    describeImageProcessingError(error) ??
    describeConfigurationError(error) ??
    describeNetworkError(error) ??
    describeAuthError(error);

  if (described) {
    return { ...described, message: prefixWithContext(described.message, options.context) };
  }

  const raw = errorText(error).trim();
  const declaredStatus = asRecord(error).status;
  const status =
    typeof declaredStatus === "number" && declaredStatus >= 400 && declaredStatus <= 599
      ? declaredStatus
      : 500;

  return {
    status,
    code: "UNEXPECTED_ERROR",
    message: prefixWithContext(
      raw ? `fallo inesperado del servidor — ${raw}` : "fallo inesperado del servidor.",
      options.context
    ),
    detail: technicalDetail(error),
    hint: "Este error no está clasificado. Busca el errorId de esta respuesta en los logs del servidor (en Railway: Deployments → Logs) para ver la traza completa.",
  };
};

/** ¿Se incluye el `detail` técnico en la respuesta? Se apaga con EXPOSE_ERROR_DETAILS=false. */
export const shouldExposeErrorDetails = (): boolean =>
  (process.env.EXPOSE_ERROR_DETAILS ?? "").trim().toLowerCase() !== "false";

export type ErrorResponseBody = {
  error: string;
  code: string;
  detail?: string;
  hint?: string;
  errorId: string;
};

/** Identificador corto para casar la respuesta que ve el admin con la línea del log del servidor. */
export const newErrorId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();

export const buildErrorResponseBody = (
  described: DescribedError,
  errorId: string
): ErrorResponseBody => {
  const expose = shouldExposeErrorDetails();
  return {
    error: described.message,
    code: described.code,
    ...(described.hint ? { hint: described.hint } : {}),
    ...(expose && described.detail ? { detail: described.detail } : {}),
    errorId,
  };
};
