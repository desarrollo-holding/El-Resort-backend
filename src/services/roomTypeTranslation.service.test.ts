import { describe, it, expect, vi, beforeEach } from "vitest";
import { Types } from "mongoose";
import { RoomTypeTranslationService } from "./roomTypeTranslation.service";
import { TranslateService } from "./translate.service";

/**
 * Bug real: `translateRoomTypeSpecsPayloadToEnglish` (y las otras funciones de este servicio)
 * clonaban el payload con `structuredClone` antes de traducir. `structuredClone` no invoca
 * `toJSON()` — a diferencia de `JSON.stringify`, que es lo que `res.json()` usa al final — así que
 * un `_id` de Mongoose (instancia de `ObjectId`) sobrevivía al clon como `{ buffer: {...} }` en vez
 * de su cadena hex. El frontend valida `_id` con `z.string()` y esa forma rota le hacía rechazar
 * TODA la respuesta — incluido `video_url` — solo en inglés, nunca en español (que no clona nada).
 */
vi.mock("./translate.service", () => ({
  TranslateService: {
    translateManySpanishToEnglish: vi.fn(async (texts: string[]) => texts.map((t) => `EN:${t}`)),
  },
}));

beforeEach(() => {
  vi.mocked(TranslateService.translateManySpanishToEnglish).mockClear();
});

describe("RoomTypeTranslationService.translateRoomTypeSpecsPayloadToEnglish", () => {
  it("conserva el _id como string (antes salía como { buffer: {...} } y tiraba toda la respuesta)", async () => {
    const payload = {
      success: true,
      data: {
        _id: new Types.ObjectId("69e10ec3eff9291c01ff5222"),
        roomTypeID: "545124",
        video_url: ["https://storage.googleapis.com/marketing_gallery/videos/algo.mp4"],
        video_url_mobile: [],
        bedrooms: [{ number: 1, description: "Dormitorio principal" }],
      },
    };

    const translated = await RoomTypeTranslationService.translateRoomTypeSpecsPayloadToEnglish(payload);

    // JSON.parse(JSON.stringify(...)) es exactamente lo que hará `res.json()`: si esto pasa, el
    // frontend ve la misma forma que vería sin traducción.
    const overWire = JSON.parse(JSON.stringify(translated)) as typeof payload;
    expect(overWire.data._id).toBe("69e10ec3eff9291c01ff5222");
    expect(typeof overWire.data._id).toBe("string");
  });

  it("no toca video_url/video_url_mobile", async () => {
    const payload = {
      data: {
        _id: new Types.ObjectId(),
        roomTypeID: "545124",
        video_url: ["https://example.com/desktop.mp4"],
        video_url_mobile: ["https://example.com/mobile.mp4"],
      },
    };

    const translated = (await RoomTypeTranslationService.translateRoomTypeSpecsPayloadToEnglish(
      payload
    )) as typeof payload;

    expect(translated.data.video_url).toEqual(["https://example.com/desktop.mp4"]);
    expect(translated.data.video_url_mobile).toEqual(["https://example.com/mobile.mp4"]);
  });

  it("sigue traduciendo la descripción de cada dormitorio", async () => {
    const payload = {
      data: {
        _id: new Types.ObjectId(),
        roomTypeID: "545124",
        bedrooms: [
          { number: 1, description: "Dormitorio principal" },
          { number: 2, description: "Segundo dormitorio" },
        ],
      },
    };

    const translated = (await RoomTypeTranslationService.translateRoomTypeSpecsPayloadToEnglish(
      payload
    )) as typeof payload;

    expect(translated.data.bedrooms?.[0]?.description).toBe("EN:Dormitorio principal");
    expect(translated.data.bedrooms?.[1]?.description).toBe("EN:Segundo dormitorio");
  });

  /**
   * `roomTypeFeatures` («beneficios incluidos») viene de CloudBeds en español. El LISTADO ya lo
   * traducía, pero el DETALLE no: eran dos recolectores separados y solo uno lo contemplaba, así
   * que la ficha de la propiedad mostraba «Estacionamiento», «Hamaca», ... en la versión en inglés.
   */
  it("traduce roomTypeFeatures en el detalle (venían de CloudBeds en español)", async () => {
    const payload = {
      data: {
        _id: new Types.ObjectId(),
        roomTypeID: "545124",
        roomTypeFeatures: ["Estacionamiento", "Hamaca", "Juegos de mesa"],
      },
    };

    const translated = (await RoomTypeTranslationService.translateRoomsShowByIdPayloadToEnglish(
      payload
    )) as typeof payload;

    expect(translated.data.roomTypeFeatures).toEqual(["Parking", "Hammock", "Board games"]);
  });

  it("sigue traduciendo roomTypeFeatures en el listado", async () => {
    const payload = {
      data: [
        {
          roomTypeID: "545124",
          presentation: { roomTypeDescription: "", roomTypeFeatures: ["Minibar", "Mosquitero"] },
        },
      ],
    };

    const translated = (await RoomTypeTranslationService.translateRoomsShowPayloadToEnglish(
      payload
    )) as typeof payload;

    expect(translated.data[0].presentation.roomTypeFeatures).toEqual(["Minibar", "Mosquito net"]);
  });

  it("usa el glosario en vez del traductor, y tolera acentos y mayúsculas", async () => {
    const payload = {
      data: {
        _id: new Types.ObjectId(),
        roomTypeID: "545124",
        // Las dos grafías que conviven en CloudBeds para la misma comodidad.
        roomTypeFeatures: ["Artículos de aseo", "articulos de aseo", "Hervidor eléctrico"],
      },
    };

    const translated = (await RoomTypeTranslationService.translateRoomsShowByIdPayloadToEnglish(
      payload
    )) as typeof payload;

    // Las dos grafías colapsan en una sola etiqueta, así que la ficha no la muestra repetida.
    expect(translated.data.roomTypeFeatures).toEqual(["Toiletries", "Electric kettle"]);
    // Nada del glosario debe llegar al traductor automático.
    expect(TranslateService.translateManySpanishToEnglish).not.toHaveBeenCalled();
  });

  it("cae al traductor para una comodidad que todavía no está en el glosario", async () => {
    const payload = {
      data: {
        _id: new Types.ObjectId(),
        roomTypeID: "545124",
        roomTypeFeatures: ["Chimenea a leña"],
      },
    };

    const translated = (await RoomTypeTranslationService.translateRoomsShowByIdPayloadToEnglish(
      payload
    )) as typeof payload;

    expect(translated.data.roomTypeFeatures).toEqual(["EN:Chimenea a leña"]);
  });

  // Lo que reportó el cliente: la ficha en ESPAÑOL mostraba «Coffee maker» y «Cribs upon request»
  // tal cual venían de CloudBeds. La rama en español no pasaba por ninguna normalización.
  it("localizeAmenities deja las comodidades en español, sin usar el traductor", () => {
    const payload = {
      data: {
        roomTypeID: "545124",
        roomTypeFeatures: ["Coffee maker", "Cribs upon request", "Hervidor", "Hairdryer"],
      },
    };

    const out = RoomTypeTranslationService.localizeAmenities(payload, "es") as typeof payload;

    expect(out.data.roomTypeFeatures).toEqual([
      "Cafetera",
      "Cunas a pedido",
      "Hervidor",
      "Secadora de pelo",
    ]);
    expect(TranslateService.translateManySpanishToEnglish).not.toHaveBeenCalled();
  });

  it("localizeAmenities no muta el payload original (la capa de CloudBeds lo cachea)", () => {
    const payload = { data: { roomTypeID: "545124", roomTypeFeatures: ["Coffee maker"] } };

    RoomTypeTranslationService.localizeAmenities(payload, "es");

    expect(payload.data.roomTypeFeatures).toEqual(["Coffee maker"]);
  });

  it("localizeAmenities también sirve para el listado", () => {
    const payload = {
      data: [{ roomTypeID: "545124", presentation: { roomTypeFeatures: ["Hairdryer", "Bathrobes"] } }],
    };

    const out = RoomTypeTranslationService.localizeAmenities(payload, "es") as typeof payload;

    expect(out.data[0].presentation.roomTypeFeatures).toEqual(["Secadora de pelo", "Batas de baño"]);
  });

  it("no muta el payload original", async () => {
    const payload = {
      data: {
        _id: new Types.ObjectId(),
        roomTypeID: "545124",
        bedrooms: [{ number: 1, description: "Dormitorio principal" }],
      },
    };

    await RoomTypeTranslationService.translateRoomTypeSpecsPayloadToEnglish(payload);

    expect(payload.data.bedrooms[0].description).toBe("Dormitorio principal");
    expect(payload.data._id).toBeInstanceOf(Types.ObjectId);
  });
});
