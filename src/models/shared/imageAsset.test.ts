import { describe, it, expect } from "vitest";
import { normalizeImageAsset, normalizeImageAssetArray } from "./imageAsset";

describe("normalizeImageAsset", () => {
  it("envuelve un string legacy como asset pelado, sin variantes", () => {
    const result = normalizeImageAsset("https://storage.googleapis.com/bucket/fotosresort/old.jpg");
    expect(result).toEqual({
      url: "https://storage.googleapis.com/bucket/fotosresort/old.jpg",
      storageKey: "",
      storagePrefix: "",
      variants: [],
    });
  });

  it("devuelve null para un string vacío", () => {
    expect(normalizeImageAsset("   ")).toBeNull();
  });

  it("pasa un objeto ya en la forma nueva tal cual, filtrando variantes corruptas", () => {
    const input = {
      url: "https://x/orig.webp",
      storageKey: "fotosresort/a/orig.webp",
      storagePrefix: "fotosresort/a",
      width: 2400,
      height: 1600,
      variants: [
        { width: 480, height: 320, format: "webp", url: "https://x/w480.webp" },
        { width: "not-a-number", url: "broken" }, // variante corrupta: se descarta
      ],
    };
    const result = normalizeImageAsset(input);
    expect(result).toEqual({
      url: "https://x/orig.webp",
      storageKey: "fotosresort/a/orig.webp",
      storagePrefix: "fotosresort/a",
      width: 2400,
      height: 1600,
      variants: [{ width: 480, height: 320, format: "webp", url: "https://x/w480.webp" }],
    });
  });

  it("devuelve null para null, undefined, número o array", () => {
    expect(normalizeImageAsset(null)).toBeNull();
    expect(normalizeImageAsset(undefined)).toBeNull();
    expect(normalizeImageAsset(42)).toBeNull();
    expect(normalizeImageAsset([])).toBeNull();
  });

  it("devuelve null si el objeto no tiene url", () => {
    expect(normalizeImageAsset({ storageKey: "x" })).toBeNull();
  });
});

describe("normalizeImageAssetArray", () => {
  it("normaliza una mezcla de strings legacy y objetos nuevos", () => {
    const result = normalizeImageAssetArray([
      "https://x/legacy1.jpg",
      { url: "https://x/orig.webp", storageKey: "k", storagePrefix: "p", width: 900, height: 600, variants: [] },
      null,
      42,
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://x/legacy1.jpg");
    expect(result[0].storageKey).toBe("");
    expect(result[1].storageKey).toBe("k");
  });

  it("devuelve [] si no es un array", () => {
    expect(normalizeImageAssetArray(undefined)).toEqual([]);
    expect(normalizeImageAssetArray("x")).toEqual([]);
  });
});
