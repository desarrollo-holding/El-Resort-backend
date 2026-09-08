import { describe, it, expect, vi, beforeEach } from "vitest";

const deletedFileIds: string[] = [];

vi.mock("./csStorage.service", () => ({
  GcsStorageService: {
    extractKeyFromUrl: vi.fn((url: string) => {
      const marker = "/test-bucket/";
      const idx = url.indexOf(marker);
      return idx < 0 ? null : url.slice(idx + marker.length);
    }),
    deleteFile: vi.fn(async ({ fileId }: { fileId: string }) => {
      deletedFileIds.push(fileId);
      return { success: true };
    }),
  },
}));

import { collectImageSrcs, cleanupOrphanedLandingMedia } from "./landingMediaOrphanCleanup";

const url = (key: string) => `https://storage.googleapis.com/test-bucket/${key}`;

beforeEach(() => {
  deletedFileIds.length = 0;
  vi.clearAllMocks();
});

describe("collectImageSrcs", () => {
  it("junta los src de hojas kind:image en cualquier profundidad", () => {
    const tree = {
      heroMobileImage: { src: url("fotosresort/a/orig.webp"), kind: "image", status: "existing" },
      heroVideo: { src: url("videos/x.mp4"), kind: "video", status: "existing" },
      subsections: {
        yanashpaVillage: {
          logo: { src: url("fotosresort/b/orig.webp"), kind: "image", status: "existing" },
        },
      },
      background: { type: "color", color: "#fff" },
    };
    const result = collectImageSrcs(tree);
    expect(result).toEqual(new Set([url("fotosresort/a/orig.webp"), url("fotosresort/b/orig.webp")]));
  });

  it("recorre arrays de nodos (carouselImages)", () => {
    const tree = {
      carouselImages: [
        { src: url("fotosresort/a/orig.webp"), kind: "image", status: "existing" },
        { src: url("fotosresort/b/orig.webp"), kind: "image", status: "existing" },
      ],
    };
    expect(collectImageSrcs(tree)).toEqual(new Set([url("fotosresort/a/orig.webp"), url("fotosresort/b/orig.webp")]));
  });

  it("ignora hojas que no son kind:image", () => {
    const tree = { thumbnail: { src: url("fotosresort/a/orig.webp"), kind: "video", status: "existing" } };
    expect(collectImageSrcs(tree)).toEqual(new Set());
  });

  it("devuelve set vacío para árboles sin imágenes, null o undefined", () => {
    expect(collectImageSrcs({ background: { type: "color" } })).toEqual(new Set());
    expect(collectImageSrcs(null)).toEqual(new Set());
    expect(collectImageSrcs(undefined as never)).toEqual(new Set());
  });
});

describe("cleanupOrphanedLandingMedia", () => {
  it("borra la imagen que fue reemplazada por otra", async () => {
    const previous = { heroMobileImage: { src: url("fotosresort/old/orig.webp"), kind: "image", status: "existing" } };
    const next = { heroMobileImage: { src: url("fotosresort/new/orig.webp"), kind: "image", status: "existing" } };

    await cleanupOrphanedLandingMedia(previous, next);

    expect(deletedFileIds).toEqual(["fotosresort/old/orig.webp"]);
  });

  it("no borra nada si la imagen se mantiene igual", async () => {
    const json = { heroMobileImage: { src: url("fotosresort/same/orig.webp"), kind: "image", status: "existing" } };
    await cleanupOrphanedLandingMedia(json, json);
    expect(deletedFileIds).toEqual([]);
  });

  it("borra todas las imágenes cuando el documento entero se elimina (nextJson: null)", async () => {
    const previous = {
      mainImage: { src: url("fotosresort/a/orig.webp"), kind: "image", status: "existing" },
      cartaBackgroundTexture: { src: url("fotosresort/b/orig.webp"), kind: "image", status: "existing" },
    };
    await cleanupOrphanedLandingMedia(previous, null);
    expect(deletedFileIds.sort()).toEqual(["fotosresort/a/orig.webp", "fotosresort/b/orig.webp"]);
  });

  it("detecta una imagen quitada de un array sin afectar a las que quedan", async () => {
    const previous = {
      carouselImages: [
        { src: url("fotosresort/a/orig.webp"), kind: "image", status: "existing" },
        { src: url("fotosresort/b/orig.webp"), kind: "image", status: "existing" },
      ],
    };
    const next = {
      carouselImages: [{ src: url("fotosresort/a/orig.webp"), kind: "image", status: "existing" }],
    };
    await cleanupOrphanedLandingMedia(previous, next);
    expect(deletedFileIds).toEqual(["fotosresort/b/orig.webp"]);
  });

  it("no hace nada si previousJson no tenía imágenes", async () => {
    await cleanupOrphanedLandingMedia({ background: { type: "color" } }, {});
    expect(deletedFileIds).toEqual([]);
  });

  it("ignora URLs que no matchean el bucket (extractKeyFromUrl devuelve null)", async () => {
    const previous = { thumbnail: { src: "https://otro-cdn.com/imagen.webp", kind: "image", status: "existing" } };
    await cleanupOrphanedLandingMedia(previous, {});
    expect(deletedFileIds).toEqual([]);
  });
});
