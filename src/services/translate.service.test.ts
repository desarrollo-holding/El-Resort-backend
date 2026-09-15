import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

/**
 * Estos tests existen para blindar la corrección del bug de costo: antes la caché se indexaba por
 * el hash del LOTE completo de textos de un request, y como el lote de `/api/rooms/show` cambia con
 * el rango de fechas que busca cada visitante, prácticamente nunca acertaba — el resultado era una
 * llamada a Gemini por búsqueda de usuario.
 *
 * Lo que se verifica acá es la propiedad que importa: **un texto dado se le manda al traductor una
 * sola vez**, sin importar en qué lote, en qué orden ni junto a qué otros textos vuelva a aparecer.
 */

const translateJsonMock = vi.fn();

/**
 * `vi.hoisted` porque las factories de `vi.mock` se elevan por encima de las declaraciones del
 * módulo: sin esto no se puede compartir estado mutable con ellas. `readyState` se deja mutable
 * para poder simular tanto "Mongo no disponible" (solo caché en memoria) como "Mongo conectado"
 * (caché persistente activa).
 */
const dbMock = vi.hoisted(() => ({
  connection: { readyState: 0 },
  find: vi.fn(),
  bulkWrite: vi.fn(),
}));

vi.mock("../integrations/geminiClient", () => ({
  GeminiClient: {
    translateJson: (obj: object) => translateJsonMock(obj),
  },
}));

vi.mock("./libreTranslate.service", () => ({
  LibreTranslateService: {
    translateMany: vi.fn(async (texts: string[]) => texts.map((t) => `LT:${t}`)),
  },
}));

vi.mock("mongoose", () => ({ default: { connection: dbMock.connection } }));

vi.mock("../models/TranslationCache", () => ({
  default: {
    find: (...args: unknown[]) => dbMock.find(...args),
    bulkWrite: (...args: unknown[]) => dbMock.bulkWrite(...args),
  },
}));

/** Encadena `.select().lean()` como hace Mongoose, devolviendo los docs dados. */
const mockFindResult = (docs: unknown[]) => {
  dbMock.find.mockReturnValue({
    select: () => ({ lean: async () => docs }),
  });
};

/** Se reimporta en cada test para resetear las cachés de módulo entre casos. */
async function freshService() {
  vi.resetModules();
  // Extensión `.js` requerida por `moduleResolution: NodeNext` para un import dinámico
  // (se resuelve como ESM); Vite/Vitest lo mapea al `.ts` real.
  const mod = await import("./translate.service.js");
  return mod.TranslateService;
}

/** Traductor falso: devuelve el mismo objeto con cada valor prefijado por "EN:". */
const fakeTranslator = async (obj: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = `EN:${v}`;
  return out;
};

beforeEach(() => {
  translateJsonMock.mockReset();
  translateJsonMock.mockImplementation(fakeTranslator);
  dbMock.find.mockReset();
  dbMock.bulkWrite.mockReset();
  dbMock.bulkWrite.mockResolvedValue(undefined);
  // Por defecto: Mongo "no conectado" ⇒ los tests de L1 no tocan la caché persistente.
  dbMock.connection.readyState = 0;
});

describe("translateManySpanishToEnglish — caché por texto", () => {
  it("traduce correctamente un lote simple", async () => {
    const TranslateService = await freshService();

    const out = await TranslateService.translateManySpanishToEnglish(["hola", "mundo"]);

    expect(out).toEqual(["EN:hola", "EN:mundo"]);
    expect(translateJsonMock).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a llamar al traductor para un texto ya traducido", async () => {
    const TranslateService = await freshService();

    await TranslateService.translateManySpanishToEnglish(["hola", "mundo"]);
    const out = await TranslateService.translateManySpanishToEnglish(["hola", "mundo"]);

    expect(out).toEqual(["EN:hola", "EN:mundo"]);
    expect(translateJsonMock).toHaveBeenCalledTimes(1); // ← la segunda vez sale 100% de caché
  });

  it("solo manda al traductor los textos NUEVOS de un lote parcialmente conocido", async () => {
    const TranslateService = await freshService();

    await TranslateService.translateManySpanishToEnglish(["hola", "mundo"]);
    translateJsonMock.mockClear();

    const out = await TranslateService.translateManySpanishToEnglish(["hola", "nuevo", "mundo"]);

    expect(out).toEqual(["EN:hola", "EN:nuevo", "EN:mundo"]);
    expect(translateJsonMock).toHaveBeenCalledTimes(1);
    // Este es el corazón del arreglo: el lote cambió de tamaño y de orden, pero solo viajó "nuevo".
    expect(translateJsonMock).toHaveBeenCalledWith({ "0": "nuevo" });
  });

  it("es indiferente al ORDEN del lote (el bug de las búsquedas por fechas)", async () => {
    const TranslateService = await freshService();

    // Simula dos búsquedas con rangos de fechas distintos: mismas propiedades, distinto orden
    // y distinto subconjunto por disponibilidad. Antes, cada variación era un cache miss total.
    await TranslateService.translateManySpanishToEnglish(["bungalow", "suite", "cabaña"]);
    translateJsonMock.mockClear();

    const out = await TranslateService.translateManySpanishToEnglish(["cabaña", "bungalow"]);

    expect(out).toEqual(["EN:cabaña", "EN:bungalow"]);
    expect(translateJsonMock).not.toHaveBeenCalled();
  });

  it("deduplica textos repetidos dentro del mismo lote", async () => {
    const TranslateService = await freshService();

    const out = await TranslateService.translateManySpanishToEnglish(["wifi", "wifi", "piscina"]);

    expect(out).toEqual(["EN:wifi", "EN:wifi", "EN:piscina"]);
    expect(translateJsonMock).toHaveBeenCalledWith({ "0": "wifi", "1": "piscina" });
  });

  it("no llama al traductor cuando todos los textos son vacíos", async () => {
    const TranslateService = await freshService();

    const out = await TranslateService.translateManySpanishToEnglish(["", "   "]);

    expect(out).toEqual(["", "   "]);
    expect(translateJsonMock).not.toHaveBeenCalled();
  });

  it("cachea el ORIGINAL cuando el traductor falla, para no reintentar en bucle", async () => {
    const TranslateService = await freshService();

    translateJsonMock.mockRejectedValue(new Error("429 rate limit"));

    const first = await TranslateService.translateManySpanishToEnglish(["hola"]);
    expect(first).toEqual(["LT:hola"]); // cayó a LibreTranslate

    translateJsonMock.mockClear();
    translateJsonMock.mockImplementation(fakeTranslator);

    const second = await TranslateService.translateManySpanishToEnglish(["hola"]);

    expect(second).toEqual(["LT:hola"]);
    expect(translateJsonMock).not.toHaveBeenCalled(); // ← no se reintenta en cada request
  });

  it("cachea el original cuando el traductor devuelve vacío para un texto", async () => {
    const TranslateService = await freshService();

    translateJsonMock.mockImplementation(async () => ({ "0": "   " }));

    const first = await TranslateService.translateManySpanishToEnglish(["Yanashpa"]);
    expect(first).toEqual(["Yanashpa"]);

    translateJsonMock.mockClear();
    const second = await TranslateService.translateManySpanishToEnglish(["Yanashpa"]);

    expect(second).toEqual(["Yanashpa"]);
    expect(translateJsonMock).not.toHaveBeenCalled();
  });
});

describe("estampida: peticiones concurrentes del mismo texto", () => {
  /**
   * El escenario del lanzamiento y el de cada redeploy de Railway: L1 vacío, L2 vacío, y N
   * visitantes llegando a la vez. Medido ANTES del arreglo: 50 requests concurrentes = 50 llamadas
   * a Gemini por el mismo texto. Debe ser 1.
   */
  it("50 requests concurrentes del mismo texto = 1 sola llamada al traductor", async () => {
    const TranslateService = await freshService();

    // Latencia realista: mantiene la llamada "en vuelo" mientras entran los demás requests.
    translateJsonMock.mockImplementation(async (obj: Record<string, string>) => {
      await new Promise((r) => setTimeout(r, 20));
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, `EN:${v}`]));
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, () => TranslateService.translateManySpanishToEnglish(["bungalow"]))
    );

    expect(translateJsonMock).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual(["EN:bungalow"]);
  });

  it("lotes concurrentes que se solapan parcialmente traducen cada texto una sola vez", async () => {
    const TranslateService = await freshService();

    translateJsonMock.mockImplementation(async (obj: Record<string, string>) => {
      await new Promise((r) => setTimeout(r, 20));
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, `EN:${v}`]));
    });

    // Simula tres búsquedas simultáneas con rangos de fechas distintos: se solapan en "suite".
    const [a, b, c] = await Promise.all([
      TranslateService.translateManySpanishToEnglish(["suite", "cabaña"]),
      TranslateService.translateManySpanishToEnglish(["suite", "bungalow"]),
      TranslateService.translateManySpanishToEnglish(["suite"]),
    ]);

    expect(a).toEqual(["EN:suite", "EN:cabaña"]);
    expect(b).toEqual(["EN:suite", "EN:bungalow"]);
    expect(c).toEqual(["EN:suite"]);

    // Cada texto único viaja exactamente una vez, repartido entre los lotes que lo reclamaron.
    const enviados = translateJsonMock.mock.calls.flatMap((call: any[]) => Object.values(call[0]));
    expect(enviados.sort()).toEqual(["bungalow", "cabaña", "suite"]);
  });

  it("libera las peticiones en vuelo aunque el traductor lance (no deja a nadie colgado)", async () => {
    const TranslateService = await freshService();

    translateJsonMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("gemini caido");
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => TranslateService.translateManySpanishToEnglish(["hola"]))
    );

    // Cae a LibreTranslate (1 solo texto ⇒ no se exige que cambie) y todos reciben respuesta.
    for (const r of results) expect(r).toEqual(["LT:hola"]);
  });
});

describe("no envenenar la caché ante un fallo transitorio del motor", () => {
  it("reintenta tras el TTL negativo en vez de grabar el español para siempre", async () => {
    vi.useFakeTimers();
    try {
      const TranslateService = await freshService();

      // El motor devuelve una forma equivocada: ni Gemini ni el fallback dan traducción útil.
      translateJsonMock.mockImplementation(async () => ({ otraClave: "algo" }));

      const first = await TranslateService.translateManySpanishToEnglish(["cabaña"]);
      expect(first).toEqual(["cabaña"]); // se devuelve el original, sin romper la respuesta

      // Dentro del TTL negativo NO se reintenta (no hay bucle por request).
      translateJsonMock.mockClear();
      await TranslateService.translateManySpanishToEnglish(["cabaña"]);
      expect(translateJsonMock).not.toHaveBeenCalled();

      // Pasados los 10 minutos, SÍ se reintenta y ya con el motor sano queda bien.
      vi.advanceTimersByTime(11 * 60 * 1000);
      translateJsonMock.mockImplementation(fakeTranslator);
      const third = await TranslateService.translateManySpanishToEnglish(["cabaña"]);
      expect(third).toEqual(["EN:cabaña"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("NO persiste en Mongo un texto que el motor no supo traducir", async () => {
    const TranslateService = await freshService();

    dbMock.connection.readyState = 1;
    mockFindResult([]);
    translateJsonMock.mockImplementation(async () => ({}));

    await TranslateService.translateManySpanishToEnglish(["cabaña"]);
    await new Promise((resolve) => setImmediate(resolve));

    // Antes se grababa el español con provider "passthrough" y nada lo reintentaba jamás.
    const ops = dbMock.bulkWrite.mock.calls.flatMap((c: any[]) => c[0] ?? []);
    expect(ops).toHaveLength(0);
  });

  it("trata 'LibreTranslate no tradujo nada' como fallo, no como traducción válida", async () => {
    const TranslateService = await freshService();

    translateJsonMock.mockRejectedValue(new Error("gemini 429"));
    // LibreTranslate caído: su servicio devuelve los ORIGINALES sin lanzar.
    const { LibreTranslateService } = await import("./libreTranslate.service.js");
    (LibreTranslateService.translateMany as any).mockImplementation(async (texts: string[]) => texts);

    const out = await TranslateService.translateManySpanishToEnglish(["uno", "dos", "tres"]);

    // Se devuelve el español (la web no se rompe) pero NO se graba como traducción buena.
    expect(out).toEqual(["uno", "dos", "tres"]);

    dbMock.connection.readyState = 1;
    mockFindResult([]);
    dbMock.bulkWrite.mockClear();
    await new Promise((resolve) => setImmediate(resolve));
    const ops = dbMock.bulkWrite.mock.calls.flatMap((c: any[]) => c[0] ?? []);
    expect(ops).toHaveLength(0);
  });
});

describe("caché persistente en Mongo (sobrevive a los redeploys de Railway)", () => {
  /** Misma fórmula que `buildTranslationHash` en el servicio. */
  const hashOf = (text: string) => createHash("sha1").update(`es:en:${text}`).digest("hex");

  it("usa la traducción guardada en Mongo sin llamar al traductor", async () => {
    const TranslateService = await freshService();

    // Simula un proceso recién arrancado (caché en memoria vacía) pero con Mongo ya poblado:
    // exactamente el estado tras un deploy en Railway.
    dbMock.connection.readyState = 1;
    mockFindResult([{ hash: hashOf("bungalow"), translatedText: "bungalow (EN)" }]);

    const out = await TranslateService.translateManySpanishToEnglish(["bungalow"]);

    expect(out).toEqual(["bungalow (EN)"]);
    expect(translateJsonMock).not.toHaveBeenCalled();
  });

  it("solo manda al traductor lo que Mongo no tiene, y persiste el resultado", async () => {
    const TranslateService = await freshService();

    dbMock.connection.readyState = 1;
    mockFindResult([{ hash: hashOf("piscina"), translatedText: "pool" }]);

    const out = await TranslateService.translateManySpanishToEnglish(["piscina", "fogata"]);

    expect(out).toEqual(["pool", "EN:fogata"]);
    expect(translateJsonMock).toHaveBeenCalledWith({ "0": "fogata" });

    // La escritura es "fire and forget": se deja avanzar el event loop antes de comprobarla.
    await new Promise((resolve) => setImmediate(resolve));

    expect(dbMock.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = dbMock.bulkWrite.mock.calls[0][0] as any[];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter.hash).toBe(hashOf("fogata"));
    expect(ops[0].updateOne.update.$set.translatedText).toBe("EN:fogata");
    expect(ops[0].updateOne.upsert).toBe(true);
  });

  it("promueve a memoria lo leído de Mongo (no reconsulta en el request siguiente)", async () => {
    const TranslateService = await freshService();

    dbMock.connection.readyState = 1;
    mockFindResult([{ hash: hashOf("bungalow"), translatedText: "bungalow (EN)" }]);

    await TranslateService.translateManySpanishToEnglish(["bungalow"]);
    dbMock.find.mockClear();

    const out = await TranslateService.translateManySpanishToEnglish(["bungalow"]);

    expect(out).toEqual(["bungalow (EN)"]);
    expect(dbMock.find).not.toHaveBeenCalled();
    expect(translateJsonMock).not.toHaveBeenCalled();
  });

  it("si la lectura de Mongo falla, sigue adelante con el traductor", async () => {
    const TranslateService = await freshService();

    dbMock.connection.readyState = 1;
    dbMock.find.mockImplementation(() => {
      throw new Error("mongo caido");
    });

    const out = await TranslateService.translateManySpanishToEnglish(["hola"]);

    expect(out).toEqual(["EN:hola"]); // la respuesta nunca se rompe por un fallo de caché
  });
});

describe("backfillEnglishField", () => {
  it("persiste el original cuando la traducción vuelve idéntica (nombres propios)", async () => {
    const TranslateService = await freshService();

    translateJsonMock.mockImplementation(async (obj: Record<string, string>) => ({ ...obj }));

    const items = [{ _id: "1", nombre: "Yoga", nombreEn: undefined as unknown as string }];
    const changed = await TranslateService.backfillEnglishField(items, "nombre", "nombreEn");

    // Debe quedar marcado como cambiado para que el caller lo persista; si no, este item
    // volvería a caer en `missing` en cada request en inglés, para siempre.
    expect(changed).toHaveLength(1);
    expect(items[0].nombreEn).toBe("Yoga");
  });

  it("no toca los items que ya tienen traducción", async () => {
    const TranslateService = await freshService();

    const items = [{ _id: "1", nombre: "Piscina", nombreEn: "Pool" }];
    const changed = await TranslateService.backfillEnglishField(items, "nombre", "nombreEn");

    expect(changed).toHaveLength(0);
    expect(items[0].nombreEn).toBe("Pool");
    expect(translateJsonMock).not.toHaveBeenCalled();
  });
});

describe("backfillEnglishArrayField", () => {
  it("aplana los arrays para que pasen por la caché por texto", async () => {
    const TranslateService = await freshService();

    const items = [
      { _id: "1", dias: ["yoga", "caminata"], diasEn: undefined as unknown as string[] },
      { _id: "2", dias: ["yoga", "fogata"], diasEn: undefined as unknown as string[] },
    ];

    const changed = await TranslateService.backfillEnglishArrayField(items, "dias", "diasEn");

    expect(changed).toHaveLength(2);
    expect(items[0].diasEn).toEqual(["EN:yoga", "EN:caminata"]);
    expect(items[1].diasEn).toEqual(["EN:yoga", "EN:fogata"]);
    // "yoga" aparece en ambos items pero solo se manda una vez.
    expect(translateJsonMock).toHaveBeenCalledWith({ "0": "yoga", "1": "caminata", "2": "fogata" });
  });
});
