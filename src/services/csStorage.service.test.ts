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

process.env.GCS_BUCKET_RESORT = "test-bucket";
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
