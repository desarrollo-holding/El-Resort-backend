import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { GcsStorageService } from "./csStorage.service";

const state = vi.hoisted(() => ({
  store: new Map<string, { buffer: Buffer; contentType?: string }>(),
  saveCounter: 0,
  failAfterNSaves: null as number | null,
  deleteFilesCalls: [] as { prefix: string }[],
}));

vi.mock("@google-cloud/storage", () => {
  class FakeFile {
    constructor(private key: string) {}
    async save(buffer: Buffer, opts: { metadata?: { contentType?: string } } = {}) {
      state.saveCounter += 1;
      if (state.failAfterNSaves !== null && state.saveCounter > state.failAfterNSaves) {
        throw new Error(`Fallo simulado al subir ${this.key}`);
      }
      state.store.set(this.key, { buffer, contentType: opts.metadata?.contentType });
    }
    async delete() {
      state.store.delete(this.key);
    }
  }

  class FakeBucket {
    file(key: string) {
      return new FakeFile(key);
    }
    async deleteFiles({ prefix }: { prefix: string; force?: boolean }) {
      state.deleteFilesCalls.push({ prefix });
      for (const key of Array.from(state.store.keys())) {
        if (key.startsWith(prefix)) state.store.delete(key);
      }
    }
    async getFiles() {
      return [Array.from(state.store.keys()).map((name) => ({ name }))];
    }
  }

  class FakeStorage {
    bucket(_name: string) {
      return new FakeBucket();
    }
  }

  return { Storage: FakeStorage };
});

// `getGcsConfigFromEnv` rechaza cualquier bucket que no sea el de producción salvo que se
// declare el override: sin esto el test solo pasaba cuando OTRO archivo del suite había
// cargado antes el `.env` real (con el bucket bueno), o sea por orden de ejecución.
process.env.GCS_BUCKET_RESORT = "test-bucket";
process.env.GCS_BUCKET_RESORT_OVERRIDE = "1";
process.env.GOOGLE_CLOUD_STORAGE_CREDENTIALS = JSON.stringify({ client_email: "x", private_key: "y" });

async function makeJpeg(width = 3000, height = 2000) {
  return sharp({ create: { width, height, channels: 3, background: { r: 100, g: 100, b: 100 } } })
    .jpeg()
    .toBuffer();
}

beforeEach(() => {
  state.store.clear();
  state.saveCounter = 0;
  state.failAfterNSaves = null;
  state.deleteFilesCalls.length = 0;
});

describe("GcsStorageService.uploadFile — imagen rasterizable", () => {
  it("crea una carpeta nueva con orig.webp + escalera de variantes", async () => {
    const buffer = await makeJpeg();
    const result = await GcsStorageService.uploadFile({
      fileBuffer: buffer,
      originalName: "foto.jpg",
      mimeType: "image/jpeg",
      mediaKind: "image",
    });

    expect(result.storageKey).toMatch(/^fotosresort\/\d+-[0-9a-f-]{36}\/orig\.webp$/);
    expect(result.fileId).toBe(result.storageKey);
    expect(result.url).toContain(result.storageKey as string);
    expect(result.variants!.length).toBeGreaterThan(0);

    for (const key of state.store.keys()) {
      expect(key.startsWith(result.storagePrefix as string)).toBe(true);
    }
  });

  it("dos subidas del mismo archivo nunca comparten carpeta (nunca sobreescribe)", async () => {
    const buffer = await makeJpeg();
    const r1 = await GcsStorageService.uploadFile({ fileBuffer: buffer, originalName: "foto.jpg", mimeType: "image/jpeg", mediaKind: "image" });
    const r2 = await GcsStorageService.uploadFile({ fileBuffer: buffer, originalName: "foto.jpg", mimeType: "image/jpeg", mediaKind: "image" });
    expect(r1.storagePrefix).not.toBe(r2.storagePrefix);
    expect(state.store.size).toBeGreaterThan(2);
  });

  it("limpia toda la carpeta si falla la subida de una variante a mitad de camino", async () => {
    const buffer = await makeJpeg();
    state.failAfterNSaves = 1; // deja pasar orig.webp, falla en la primera variante

    await expect(
      GcsStorageService.uploadFile({ fileBuffer: buffer, originalName: "foto.jpg", mimeType: "image/jpeg", mediaKind: "image" })
    ).rejects.toThrow();

    expect(state.store.size).toBe(0);
  });

  it("usa el perfil avatar (sin escalera) cuando se pide explícitamente", async () => {
    const buffer = await makeJpeg();
    const result = await GcsStorageService.uploadFile({
      fileBuffer: buffer,
      originalName: "avatar.jpg",
      mimeType: "image/jpeg",
      mediaKind: "image",
      imageProfile: "avatar",
    });
    expect(result.variants).toEqual([]);
    expect(result.width).toBeLessThanOrEqual(480);
  });
});

describe("GcsStorageService.uploadFile — excepciones sin recodificar", () => {
  it("sube SVG tal cual, sin carpeta de variantes", async () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    const result = await GcsStorageService.uploadFile({
      fileBuffer: svg,
      originalName: "logo.svg",
      mimeType: "image/svg+xml",
      mediaKind: "image",
    });
    expect(result.storagePrefix).toBeUndefined();
    expect(result.variants).toEqual([]);
    expect(state.store.get(result.fileId)?.buffer.toString()).toBe(svg.toString());
  });

  it("no recodifica video: lo sube tal cual", async () => {
    const fakeVideo = Buffer.from("no-es-un-video-real");
    const result = await GcsStorageService.uploadFile({
      fileBuffer: fakeVideo,
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      mediaKind: "video",
    });
    expect(result.fileId).toMatch(/^videos\//);
    expect(result.variants).toEqual([]);
  });

  // Este es el caso que dejaba el vídeo sin reproducir: el navegador manda la parte como
  // `application/octet-stream` (Windows, extensión sin asociar) y ese valor acababa siendo el
  // Content-Type publicado, así que el `<video>` descartaba la fuente sin decodificarla.
  it("publica el video con un tipo de medios aunque el navegador no haya declarado ninguno", async () => {
    const fakeVideo = Buffer.from("no-es-un-video-real");

    const octetStream = await GcsStorageService.uploadFile({
      fileBuffer: fakeVideo,
      originalName: "tour.mp4",
      mimeType: "application/octet-stream",
      mediaKind: "video",
    });
    expect(state.store.get(octetStream.fileId)?.contentType).toBe("video/mp4");

    const sinTipo = await GcsStorageService.uploadFile({
      fileBuffer: fakeVideo,
      originalName: "vertical.webm",
      mimeType: "",
      mediaKind: "video",
    });
    expect(state.store.get(sinTipo.fileId)?.contentType).toBe("video/webm");
  });

  it("codifica la URL pública del objeto plano: el nombre original entra en la clave", async () => {
    const fakeVideo = Buffer.from("no-es-un-video-real");
    const result = await GcsStorageService.uploadFile({
      fileBuffer: fakeVideo,
      originalName: "Village 5 #2 final.mp4",
      mimeType: "video/mp4",
      mediaKind: "video",
    });

    // La clave del objeto conserva el nombre tal cual...
    expect(result.fileId).toContain("Village 5 #2 final.mp4");
    // ...pero la URL no puede llevar el `#` crudo: cortaría la petición antes del archivo.
    expect(result.url).not.toContain("#");
    expect(result.url).toContain("Village%205%20%232%20final.mp4");
    // Y el camino inverso sigue devolviendo la clave original, para poder borrar el objeto.
    expect(GcsStorageService.extractKeyFromUrl(result.url)).toBe(result.fileId);
  });

  // HEVC se oye pero se ve negro en los equipos sin decodificación por hardware: no debe llegar
  // al bucket (ver videoCodec.ts). Se arma un MP4 mínimo con una pista `vide` cuyo `stsd` es `hvc1`.
  it("rechaza un video HEVC antes de subir nada", async () => {
    const box = (type: string, ...children: Buffer[]): Buffer => {
      const body = Buffer.concat(children);
      const header = Buffer.alloc(8);
      header.writeUInt32BE(8 + body.length, 0);
      header.write(type, 4, "latin1");
      return Buffer.concat([header, body]);
    };
    const hdlr = Buffer.alloc(25);
    hdlr.write("vide", 8, "latin1");
    const stsdHeader = Buffer.alloc(8);
    stsdHeader.writeUInt32BE(1, 4);
    const stbl = box("stbl", box("stsd", stsdHeader, box("hvc1", Buffer.alloc(78))));
    const hevcVideo = Buffer.concat([
      box("ftyp", Buffer.from("isom", "latin1")),
      box("mdat", Buffer.alloc(32)),
      box("moov", box("trak", box("mdia", box("hdlr", hdlr), box("minf", stbl)))),
    ]);

    await expect(
      GcsStorageService.uploadFile({ fileBuffer: hevcVideo, originalName: "HT33.mp4", mimeType: "video/mp4", mediaKind: "video" })
    ).rejects.toMatchObject({ name: "UnsupportedVideoCodecError", codec: "hvc1", fileName: "HT33.mp4" });
    expect(state.store.size).toBe(0);
  });
});

describe("GcsStorageService.deleteFile", () => {
  it("borra la carpeta entera cuando el fileId apunta a orig.webp", async () => {
    const buffer = await makeJpeg();
    const uploaded = await GcsStorageService.uploadFile({ fileBuffer: buffer, originalName: "foto.jpg", mimeType: "image/jpeg", mediaKind: "image" });
    expect(state.store.size).toBeGreaterThan(1);

    await GcsStorageService.deleteFile({ fileId: uploaded.fileId });

    expect(state.store.size).toBe(0);
    expect(state.deleteFilesCalls).toContainEqual({ prefix: uploaded.storagePrefix });
  });

  it("borra solo el objeto puntual para archivos planos (legado, svg, video)", async () => {
    state.store.set("fotosresort/123_logo.svg", { buffer: Buffer.from("x") });
    state.store.set("fotosresort/999_otra.png", { buffer: Buffer.from("y") });

    await GcsStorageService.deleteFile({ fileId: "fotosresort/123_logo.svg" });

    expect(state.store.has("fotosresort/123_logo.svg")).toBe(false);
    expect(state.store.has("fotosresort/999_otra.png")).toBe(true);
  });
});

describe("GcsStorageService.deleteFiles (borrado múltiple)", () => {
  it("agrupa por carpeta cuando varios fileIds son orig.webp de subidas distintas", async () => {
    const buffer = await makeJpeg();
    const a = await GcsStorageService.uploadFile({ fileBuffer: buffer, originalName: "a.jpg", mimeType: "image/jpeg", mediaKind: "image" });
    const b = await GcsStorageService.uploadFile({ fileBuffer: buffer, originalName: "b.jpg", mimeType: "image/jpeg", mediaKind: "image" });
    state.store.set("fotosresort/legacy_flat.png", { buffer: Buffer.from("z") });

    await GcsStorageService.deleteFiles({ fileIds: [a.fileId, b.fileId, "fotosresort/legacy_flat.png"] });

    expect(state.store.size).toBe(0);
  });
});
