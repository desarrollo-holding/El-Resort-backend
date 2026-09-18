import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ImageAssetType } from "../../models/shared/imageAsset";

const deletedFileIds: string[] = [];

vi.mock("../../services/csStorage.service", () => ({
  GcsStorageService: {
    deleteFile: vi.fn(async ({ fileId }: { fileId: string }) => {
      deletedFileIds.push(fileId);
      return { success: true };
    }),
  },
}));

import {
  resolveKeptImageAssets,
  resolveKeptSingleImageAsset,
  mergeImageAssets,
  diffRemovedImageAssets,
  diffRemovedSingleImageAsset,
  cleanupRemovedImageAssets,
} from "./imageAssetSync";

const asset = (n: string, overrides: Partial<ImageAssetType> = {}): ImageAssetType => ({
  url: `https://x/${n}/orig.webp`,
  storageKey: `fotosresort/${n}/orig.webp`,
  storagePrefix: `fotosresort/${n}`,
  width: 1000,
  height: 800,
  variants: [],
  ...overrides,
});

beforeEach(() => {
  deletedFileIds.length = 0;
  vi.clearAllMocks();
});

describe("resolveKeptImageAssets", () => {
  it("resuelve URLs mantenidas contra los assets existentes, preservando variantes", () => {
    const existing = [asset("a"), asset("b")];
    const result = resolveKeptImageAssets(existing, [asset("b").url]);
    expect(result).toEqual([asset("b")]);
  });

  it("una URL que no matchea nada existente se degrada a asset pelado, no se descarta", () => {
    const result = resolveKeptImageAssets([asset("a")], ["https://otra-fuente/x.jpg"]);
    expect(result).toEqual([{ url: "https://otra-fuente/x.jpg", storageKey: "", storagePrefix: "", variants: [] }]);
  });

  it("ignora URLs vacías", () => {
    expect(resolveKeptImageAssets([asset("a")], [])).toEqual([]);
  });

  /**
   * Regresión del incidente del 17/09/2026: 183 fotos borradas.
   * `MEDIA_PUBLIC_BASE_URL` hacía que la API devolviera la imagen como `https://elresort.pe/cms/<clave>`
   * mientras el documento la tenía guardada como URL del bucket. El dashboard reenviaba la forma
   * `/cms`, no coincidía ninguna cadena, y la foto conservada acababa borrada del storage.
   */
  it("empareja por clave de objeto aunque la URL llegue con otra forma (proxy /cms, otro bucket)", () => {
    const existing = [asset("a", { url: "https://storage.googleapis.com/bucket-viejo/fotosresort/a/orig.webp" })];

    for (const entrante of [
      "https://elresort.pe/cms/fotosresort/a/orig.webp",
      "/cms/fotosresort/a/orig.webp",
      "https://storage.googleapis.com/bucket-nuevo/fotosresort/a/orig.webp",
    ]) {
      const [resuelto] = resolveKeptImageAssets(existing, [entrante]);
      expect(resuelto, entrante).toEqual(existing[0]);
      // Lo que de verdad importa: sigue teniendo storageKey, así que diffRemoved no lo da por
      // eliminado y cleanupRemovedImageAssets no borra su carpeta de variantes.
      expect(resuelto.storageKey).toBe("fotosresort/a/orig.webp");
    }
  });

  it("no empareja imágenes distintas que comparten sufijo de ruta", () => {
    const existing = [asset("a")];
    const [resuelto] = resolveKeptImageAssets(existing, ["https://x/otrofotosresort/a/orig.webp"]);
    expect(resuelto.storageKey).toBe("");
  });
});

describe("regresión: un cambio de formato de URL no debe borrar nada", () => {
  it("la foto conservada con URL reescrita no se clasifica como eliminada", async () => {
    const existing = [asset("a"), asset("b")];
    // El usuario no quitó nada: reenvía las dos, pero a través del proxy /cms.
    const survivientes = resolveKeptImageAssets(existing, [
      "https://elresort.pe/cms/fotosresort/a/orig.webp",
      "https://elresort.pe/cms/fotosresort/b/orig.webp",
    ]);

    const eliminadas = diffRemovedImageAssets(existing, survivientes);
    expect(eliminadas).toEqual([]);

    await cleanupRemovedImageAssets(eliminadas);
    expect(deletedFileIds).toEqual([]);
  });

  it("quitar una foto de verdad sí borra la suya, y solo la suya", async () => {
    const existing = [asset("a"), asset("b")];
    const survivientes = resolveKeptImageAssets(existing, ["https://elresort.pe/cms/fotosresort/a/orig.webp"]);

    await cleanupRemovedImageAssets(diffRemovedImageAssets(existing, survivientes));
    expect(deletedFileIds).toEqual(["fotosresort/b/orig.webp"]);
  });
});

describe("resolveKeptSingleImageAsset", () => {
  it("conserva el asset existente si la URL enviada coincide", () => {
    const existing = asset("portada");
    expect(resolveKeptSingleImageAsset(existing, existing.url)).toEqual(existing);
  });

  it("degrada a asset pelado si la URL no coincide con el existente", () => {
    const result = resolveKeptSingleImageAsset(asset("portada"), "https://otra/imagen.jpg");
    expect(result).toEqual({ url: "https://otra/imagen.jpg", storageKey: "", storagePrefix: "", variants: [] });
  });

  it("degrada a asset pelado si no hay existente", () => {
    const result = resolveKeptSingleImageAsset(null, "https://otra/imagen.jpg");
    expect(result?.storageKey).toBe("");
  });
});

describe("mergeImageAssets", () => {
  it("concatena conservadas + subidas sin duplicar por storageKey", () => {
    const kept = [asset("a")];
    const uploaded = [asset("b"), asset("a")]; // "a" repetida no debe duplicarse
    expect(mergeImageAssets(kept, uploaded)).toEqual([asset("a"), asset("b")]);
  });
});

describe("diffRemovedImageAssets / diffRemovedSingleImageAsset", () => {
  it("detecta las imágenes que salieron de un array", () => {
    const existing = [asset("a"), asset("b"), asset("c")];
    const surviving = [asset("b")];
    expect(diffRemovedImageAssets(existing, surviving)).toEqual([asset("a"), asset("c")]);
  });

  it("no reporta nada removido si todo sigue", () => {
    const existing = [asset("a")];
    expect(diffRemovedImageAssets(existing, [asset("a")])).toEqual([]);
  });

  it("detecta el reemplazo de un campo de una sola imagen", () => {
    expect(diffRemovedSingleImageAsset(asset("old"), asset("new"))).toEqual(asset("old"));
  });

  it("no reporta nada si el campo de una sola imagen no cambió de identidad", () => {
    expect(diffRemovedSingleImageAsset(asset("same"), asset("same"))).toBeNull();
  });

  it("no reporta nada si no había nada antes", () => {
    expect(diffRemovedSingleImageAsset(null, asset("new"))).toBeNull();
  });
});

describe("cleanupRemovedImageAssets", () => {
  it("borra del storage solo los assets con storageKey real", async () => {
    const legacy: ImageAssetType = { url: "https://legacy/x.jpg", storageKey: "", storagePrefix: "", variants: [] };
    await cleanupRemovedImageAssets([asset("a"), legacy, null, undefined]);
    expect(deletedFileIds).toEqual(["fotosresort/a/orig.webp"]);
  });

  it("no hace nada si la lista está vacía", async () => {
    await cleanupRemovedImageAssets([]);
    expect(deletedFileIds).toEqual([]);
  });
});
