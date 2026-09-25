import { describe, it, expect } from "vitest";
import { describeError, formatBytes, buildErrorResponseBody } from "./describeError";
import { toHttpError } from "./errors";
import { UnsupportedVideoCodecError } from "../services/videoCodec";

const multerError = (code: string, field?: string) =>
  Object.assign(new Error("File too large"), { name: "MulterError", code, field });

describe("describeError · subidas (multer)", () => {
  it("dice el tamaño máximo exacto cuando el archivo se pasa del límite", () => {
    const described = describeError(multerError("LIMIT_FILE_SIZE", "mediaFiles[hero.video]"), {
      uploadLimits: { fileSizeBytes: 20 * 1024 * 1024, filesLimit: 100 },
    });

    expect(described.status).toBe(413);
    expect(described.code).toBe("UPLOAD_FILE_TOO_LARGE");
    expect(described.message).toContain("20 MB");
    // El admin tiene que saber CUÁL de los archivos que subió es el que sobra.
    expect(described.message).toContain("hero.video");
    expect(described.hint).toContain("MAX_UPLOAD_FILE_SIZE_MB");
  });

  it("sin límite conocido sigue diciendo que el problema es el tamaño", () => {
    const described = describeError(multerError("LIMIT_FILE_SIZE"));
    expect(described.status).toBe(413);
    expect(described.message.toLowerCase()).toContain("tamaño máximo");
  });

  it("distingue demasiados archivos de archivo demasiado grande", () => {
    const described = describeError(multerError("LIMIT_FILE_COUNT"), {
      uploadLimits: { fileSizeBytes: 1, filesLimit: 5 },
    });
    expect(described.code).toBe("UPLOAD_TOO_MANY_FILES");
    expect(described.message).toContain("5");
  });
});

describe("describeError · base de datos", () => {
  it("convierte una caída de Mongo en 503 con qué revisar", () => {
    const error = Object.assign(new Error("connection timed out"), {
      name: "MongooseServerSelectionError",
    });
    const described = describeError(error);

    expect(described.status).toBe(503);
    expect(described.code).toBe("DATABASE_UNAVAILABLE");
    expect(described.hint).toContain("DATABASE_URL");
  });

  it("nombra el campo duplicado en un choque de índice único", () => {
    const error = Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
      keyValue: { sectionId: "hero" },
    });
    const described = describeError(error);

    expect(described.status).toBe(409);
    expect(described.message).toContain("sectionId");
  });

  it("lista los campos inválidos de una validación de Mongoose", () => {
    const error = Object.assign(new Error("Validation failed"), {
      name: "ValidationError",
      errors: { titulo: new Error("titulo es requerido") },
    });
    const described = describeError(error);

    expect(described.status).toBe(400);
    expect(described.message).toContain("titulo es requerido");
  });
});

describe("describeError · configuración y servicios externos", () => {
  it("señala la variable de entorno que falta", () => {
    const described = describeError(new Error("CLOUDFLARE_WORKER_URL no está definido"));

    expect(described.code).toBe("SERVER_MISCONFIGURED");
    expect(described.message).toContain("CLOUDFLARE_WORKER_URL");
    expect(described.hint).toContain("CLOUDFLARE_WORKER_URL");
  });

  it("explica un fallo de credenciales de Google Cloud Storage", () => {
    const described = describeError(new Error("Could not load the default credentials"));

    expect(described.code).toBe("STORAGE_CREDENTIALS_INVALID");
    expect(described.hint).toContain("credenciales");
  });

  it("marca como 502 un servicio externo inalcanzable", () => {
    const error = Object.assign(new Error("getaddrinfo ENOTFOUND api.cloudbeds.com"), {
      code: "ENOTFOUND",
      hostname: "api.cloudbeds.com",
    });
    const described = describeError(error);

    expect(described.status).toBe(502);
    expect(described.message).toContain("api.cloudbeds.com");
  });
});

describe("describeError · vídeo en HEVC", () => {
  it("lo rechaza con 415, nombra el archivo y dice cómo reexportarlo", () => {
    const described = describeError(new UnsupportedVideoCodecError("HT33.mp4", "hvc1"), {
      context: "Error al guardar la ficha de la habitación",
    });

    expect(described.status).toBe(415);
    expect(described.code).toBe("UNSUPPORTED_VIDEO_CODEC");
    expect(described.message).toContain("Error al guardar la ficha de la habitación:");
    expect(described.message).toContain("«HT33.mp4»");
    expect(described.hint).toContain("H.264");
  });

  // El mensaje del error lleva el nombre del archivo, y hay clasificadores que buscan palabras.
  it("no lo confunde con otro error por palabras del nombre del archivo", () => {
    const described = describeError(new UnsupportedVideoCodecError("storage permission corrupt.mp4", "hev1"));
    expect(described.code).toBe("UNSUPPORTED_VIDEO_CODEC");
  });
});

describe("describeError · el resto", () => {
  it("respeta tal cual el mensaje de un error 4xx lanzado a propósito", () => {
    const described = describeError(toHttpError(400, "El campo sectionId es requerido"));

    expect(described.status).toBe(400);
    expect(described.message).toBe("El campo sectionId es requerido");
  });

  it("NUNCA devuelve un 500 mudo: incluye el mensaje real del error", () => {
    const described = describeError(new Error("algo raro pasó en el servicio X"));

    expect(described.status).toBe(500);
    expect(described.message).toContain("algo raro pasó en el servicio X");
    expect(described.detail).toContain("Error");
    expect(described.hint).toContain("errorId");
  });

  it("antepone el contexto de la operación al motivo", () => {
    const described = describeError(new Error("boom"), { context: "Error al crear el extra" });
    expect(described.message.startsWith("Error al crear el extra:")).toBe(true);
  });

  it("no repite el contexto si el mensaje ya empieza por él", () => {
    const described = describeError(toHttpError(400, "Error al crear el extra: falta el nombre"), {
      context: "Error al crear el extra",
    });
    expect(described.message).toBe("Error al crear el extra: falta el nombre");
  });
});

describe("buildErrorResponseBody", () => {
  it("oculta el detalle técnico si EXPOSE_ERROR_DETAILS=false", () => {
    const anterior = process.env.EXPOSE_ERROR_DETAILS;
    process.env.EXPOSE_ERROR_DETAILS = "false";
    try {
      const body = buildErrorResponseBody(describeError(new Error("interno")), "ABC");
      expect(body.detail).toBeUndefined();
      expect(body.error).toBeTruthy();
      expect(body.errorId).toBe("ABC");
    } finally {
      if (anterior === undefined) delete process.env.EXPOSE_ERROR_DETAILS;
      else process.env.EXPOSE_ERROR_DETAILS = anterior;
    }
  });
});

describe("formatBytes", () => {
  it("usa unidades legibles", () => {
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
    expect(formatBytes(Math.round(1.5 * 1024 * 1024))).toBe("1.5 MB");
    expect(formatBytes(850 * 1024)).toBe("850 KB");
  });
});
