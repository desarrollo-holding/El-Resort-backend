import { describe, it, expect, vi } from "vitest";

vi.mock("../services/csStorage.service", () => ({
  GcsStorageService: {
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    extractKeyFromUrl: vi.fn(() => null),
  },
}));

import { normalizeJsonMediaNodes } from "./LandingMediaController";

const noFiles = () => new Map<string, Express.Multer.File[]>();

/**
 * Ranuras opcionales (p. ej. los iconos de esquina que cada sección puede o no tener): el
 * dashboard las manda con `src: ""` hasta que alguien sube la imagen, y antes eso respondía
 * 400 `src invalido:` y tumbaba el guardado entero de la sección.
 */
describe("normalizeJsonMediaNodes: ranura de medio vacía", () => {
  it("acepta `src` vacío y lo guarda como hueco", async () => {
    const result = (await normalizeJsonMediaNodes(
      { decoratives: { topFlower: { src: "", kind: "image", status: "missing" } } },
      noFiles(),
      []
    )) as Record<string, Record<string, Record<string, unknown>>>;

    expect(result.decoratives.topFlower).toEqual({
      src: "",
      kind: "image",
      status: "missing",
    });
  });

  it("conserva el `kind` declarado aunque no haya extensión que mirar", async () => {
    const result = (await normalizeJsonMediaNodes(
      { video: { src: "   ", kind: "video", status: "existing" } },
      noFiles(),
      []
    )) as Record<string, Record<string, unknown>>;

    expect(result.video).toMatchObject({ src: "", kind: "video", status: "missing" });
  });

  it("tira la metadata de la imagen anterior al vaciar la ranura", async () => {
    const result = (await normalizeJsonMediaNodes(
      {
        bottomLeaf: {
          src: "",
          kind: "image",
          status: "existing",
          width: 300,
          height: 260,
          variants: [{ width: 480, height: 416, format: "webp", url: "https://x/w480.webp" }],
        },
      },
      noFiles(),
      []
    )) as Record<string, Record<string, unknown>>;

    expect(result.bottomLeaf).not.toHaveProperty("width");
    expect(result.bottomLeaf).not.toHaveProperty("height");
    expect(result.bottomLeaf).not.toHaveProperty("variants");
  });

  it("sigue rechazando un `src` con texto que no es URL ni media://", async () => {
    await expect(
      normalizeJsonMediaNodes({ mapImage: { src: "no-soy-una-url", kind: "image" } }, noFiles(), [])
    ).rejects.toThrow(/src invalido/i);
  });

  it("no toca una URL pública ya guardada", async () => {
    const url = "https://storage.googleapis.com/greendreams_bucket/fotosresort/x/orig.webp";
    const result = (await normalizeJsonMediaNodes(
      { topFlower: { src: url, kind: "image", status: "existing" } },
      noFiles(),
      []
    )) as Record<string, Record<string, unknown>>;

    expect(result.topFlower).toMatchObject({ src: url, kind: "image", status: "existing" });
  });
});
