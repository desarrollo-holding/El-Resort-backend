import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Request, Response } from "express";
import type { Server } from "http";
import { createMemoryUpload } from "../config/upload";
import { apiNotFoundHandler, errorHandler } from "./errorHandler";

/**
 * Prueba de extremo a extremo del caso que originó todo esto: subir un vídeo más pesado que el
 * límite. Multer aborta la petición ANTES del controller, así que solo un manejador de errores a
 * nivel de app puede contestar algo útil; sin él, Express devuelve HTML con un 500 pelado.
 */
const MAX_BYTES = 1024; // 1 KB, para no mover megabytes en un test

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  const upload = createMemoryUpload(2, MAX_BYTES);

  app.post("/api/media", upload.any(), (req: Request, res: Response) => {
    res.json({ recibidos: (req.files as Express.Multer.File[]).length });
  });

  // Las rutas reales usan las tres formas: `.any()` (landing-media), `.array()` (áreas, extras,
  // reclamos) y `.single()` (condominios). Todas tienen que pasar por el mismo manejador.
  app.post("/api/array", upload.array("imagenes", 2), (req: Request, res: Response) => {
    res.json({ recibidos: (req.files as Express.Multer.File[]).length });
  });

  app.post("/api/single", upload.single("map_url"), (req: Request, res: Response) => {
    res.json({ recibidos: req.file ? 1 : 0 });
  });

  app.post("/api/boom", (_req, _res, next) => {
    next(Object.assign(new Error("connection timed out"), { name: "MongooseServerSelectionError" }));
  });

  app.use("/api", apiNotFoundHandler);
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const subirArchivo = async (
  bytes: number,
  campo = "mediaFiles[hero.video]",
  ruta = "/api/media"
) => {
  const form = new FormData();
  form.append(campo, new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), "portada.mp4");
  const response = await fetch(`${baseUrl}${ruta}`, { method: "POST", body: form });
  return { response, body: (await response.json()) as Record<string, unknown> };
};

describe("errorHandler", () => {
  it("un archivo dentro del límite pasa sin tocar el manejador de errores", async () => {
    const { response, body } = await subirArchivo(MAX_BYTES - 10);
    expect(response.status).toBe(200);
    expect(body.recibidos).toBe(1);
  });

  it("un vídeo demasiado pesado contesta 413 con el límite, el campo y qué hacer", async () => {
    const { response, body } = await subirArchivo(MAX_BYTES + 500);

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.code).toBe("UPLOAD_FILE_TOO_LARGE");
    expect(String(body.error)).toContain("1 KB");
    expect(String(body.error)).toContain("hero.video");
    expect(String(body.hint)).toContain("MAX_UPLOAD_FILE_SIZE_MB");
    // El id permite casar lo que ve el admin con la línea del log del servidor.
    expect(String(body.errorId).length).toBeGreaterThan(0);
  });

  it("upload.array sigue funcionando y también avisa del límite", async () => {
    const ok = await subirArchivo(MAX_BYTES - 10, "imagenes", "/api/array");
    expect(ok.response.status).toBe(200);
    expect(ok.body.recibidos).toBe(1);

    const grande = await subirArchivo(MAX_BYTES + 500, "imagenes", "/api/array");
    expect(grande.response.status).toBe(413);
    expect(grande.body.code).toBe("UPLOAD_FILE_TOO_LARGE");
  });

  it("upload.single sigue funcionando y también avisa del límite", async () => {
    const ok = await subirArchivo(MAX_BYTES - 10, "map_url", "/api/single");
    expect(ok.response.status).toBe(200);
    expect(ok.body.recibidos).toBe(1);

    const grande = await subirArchivo(MAX_BYTES + 500, "map_url", "/api/single");
    expect(grande.response.status).toBe(413);
    expect(grande.body.code).toBe("UPLOAD_FILE_TOO_LARGE");
  });

  it("un error de servidor sin atrapar explica la causa en vez de un 500 mudo", async () => {
    const response = await fetch(`${baseUrl}/api/boom`, { method: "POST" });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.code).toBe("DATABASE_UNAVAILABLE");
    expect(String(body.hint)).toContain("DATABASE_URL");
  });

  it("una ruta inexistente del API contesta JSON, no la página HTML de Express", async () => {
    const response = await fetch(`${baseUrl}/api/no-existe`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(404);
    expect(body.code).toBe("ROUTE_NOT_FOUND");
    expect(String(body.error)).toContain("/api/no-existe");
  });
});
