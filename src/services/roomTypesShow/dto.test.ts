import { describe, it, expect } from "vitest";
import { asString, asNumber, asStringArray, asRecord, normalizeRoomTypeFeatures, toReducedModel, toReducedDetailModel, buildLocalBaseRateFallback } from "./dto";
import type { RoomTypeModel } from "../../models/RoomType.model";
import type { LocalSpecsNormalized } from "./types";

describe("buildLocalBaseRateFallback", () => {
  it("usa el totalRate local cuando existe", () => {
    const fallback = buildLocalBaseRateFallback("bungalow-parejas", { totalRate: 250 });
    expect(fallback.roomRate).toBe(250);
    expect(fallback.totalRate).toBe(250);
  });

  it("cae a 0 cuando no hay pricing local", () => {
    const fallback = buildLocalBaseRateFallback("bungalow-parejas");
    expect(fallback.totalRate).toBe(0);
  });

  it("marca roomsAvailable: 0 siempre (no reservable in-app)", () => {
    expect(buildLocalBaseRateFallback("bungalow-parejas", { totalRate: 250 }).roomsAvailable).toBe(0);
  });

  it("genera un rateID identificable como local", () => {
    expect(buildLocalBaseRateFallback("bungalow-parejas").rateID).toBe("local:bungalow-parejas");
  });
});

describe("scalar coercion helpers", () => {
  it("asString solo pasa strings", () => {
    expect(asString("hi")).toBe("hi");
    expect(asString(5)).toBeUndefined();
  });

  it("asNumber solo pasa numbers finitos", () => {
    expect(asNumber(5)).toBe(5);
    expect(asNumber(NaN)).toBeUndefined();
    expect(asNumber("5")).toBeUndefined();
  });

  it("asStringArray filtra elementos no-string", () => {
    expect(asStringArray(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(asStringArray("not-array")).toBeUndefined();
  });

  it("asRecord solo pasa objetos planos (no arrays)", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1, 2])).toBeUndefined();
    expect(asRecord(null)).toBeUndefined();
  });
});

describe("normalizeRoomTypeFeatures", () => {
  it("pasa un array de strings tal cual", () => {
    expect(normalizeRoomTypeFeatures(["wifi", "pool"])).toEqual(["wifi", "pool"]);
  });

  it("convierte un objeto indexado numéricamente en array ordenado", () => {
    expect(normalizeRoomTypeFeatures({ "1": "pool", "0": "wifi" })).toEqual(["wifi", "pool"]);
  });

  it("devuelve undefined si no es array ni objeto", () => {
    expect(normalizeRoomTypeFeatures("x")).toBeUndefined();
  });
});

const baseModel = (): RoomTypeModel => ({
  roomTypeID: "rt1",
  presentation: {
    roomTypeName: "Cloudbeds Name",
    roomTypeDescription: "Cloudbeds Description",
    roomTypePhotos: ["photo1.jpg"],
    maxGuests: 4,
    roomTypeFeatures: ["wifi"],
  },
  inventory: { roomIDs: ["r1"], roomNames: ["Room 1"] },
  pricing: { ratePlans: [] },
});

describe("toReducedModel", () => {
  it("usa datos de Cloudbeds cuando no hay overrides locales", () => {
    const result = toReducedModel(baseModel());
    expect(result.roomTypeName).toBe("Cloudbeds Name");
    expect(result.maxGuests).toBe(4);
    expect(result.portada).toBeNull();
    expect((result as any).portadaMenu).toBeUndefined();
  });

  it("el nombre local reemplaza al de Cloudbeds cuando tiene contenido", () => {
    const localSpecs: LocalSpecsNormalized = { bathroomsCount: 2, bedrooms: [{ number: 1, photos: [] }], roomTypeNameLocalEs: "Bungalow Local" };
    const result = toReducedModel(baseModel(), localSpecs);
    expect(result.roomTypeName).toBe("Bungalow Local");
    expect(result.bathroomsCount).toBe(2);
    expect(result.bedroomsCount).toBe(1);
  });

  it("aplica bedrooms por defecto cuando localSpecs no trae dormitorios", () => {
    const localSpecs: LocalSpecsNormalized = { bathroomsCount: 3, bedrooms: [] };
    const result = toReducedModel(baseModel(), localSpecs);
    expect(result.bedroomsCount).toBe(1);
  });

  it("incluye portadaMenu solo cuando se pide explícitamente", () => {
    const portadaMenu = { url: "menu.jpg", storageKey: "", storagePrefix: "", variants: [] };
    const localSpecs: LocalSpecsNormalized = { bathroomsCount: 1, bedrooms: [], portadaMenu };
    const withMenu = toReducedModel(baseModel(), localSpecs, { includePortadaMenu: true });
    expect((withMenu as any).portadaMenu).toEqual(portadaMenu);
    const withoutMenu = toReducedModel(baseModel(), localSpecs);
    expect((withoutMenu as any).portadaMenu).toBeUndefined();
  });

  it("pricing local gana sobre Cloudbeds", () => {
    const result = toReducedModel(baseModel(), undefined, undefined, { totalRate: 500 });
    expect(result.pricing.totalRate).toBe(500);
  });

  it("maxGuests nunca queda undefined (propiedad sin Cloudbeds ni override local cae a 0)", () => {
    const modelSinCloudbeds: RoomTypeModel = {
      ...baseModel(),
      presentation: { ...baseModel().presentation, maxGuests: undefined },
    };
    const result = toReducedModel(modelSinCloudbeds);
    expect(result.maxGuests).toBe(0);
    expect(result.maxGuests).not.toBeUndefined();
  });
});

describe("toReducedDetailModel", () => {
  it("no expone portada pero siempre expone portadaMenu", () => {
    const result = toReducedDetailModel(baseModel()) as any;
    expect(result.portada).toBeUndefined();
    expect(result.portadaMenu).toBeNull();
  });

  it("usa roomTypeFeatures de Cloudbeds cuando no hay beneficios locales", () => {
    const result = toReducedDetailModel(baseModel());
    expect(result.beneficios).toEqual([]);
    expect(result.roomTypeFeatures).toEqual(["wifi"]);
  });
});
