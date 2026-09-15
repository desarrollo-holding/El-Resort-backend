import crypto from "crypto";
import mongoose from "mongoose";
import { GeminiClient } from "../integrations/geminiClient";
import { LibreTranslateService } from "./libreTranslate.service";
import TranslationCache from "../models/TranslationCache";

type CacheEntry = { value: unknown; expiresAt: number };

type JsonLeaf = { path: Array<string | number>; value: string };

/** Recorre un JSON arbitrario (objeto/array anidado) y junta cada hoja `string` no vacía con su ruta. */
function collectStringLeaves(node: unknown, path: Array<string | number>, out: JsonLeaf[]): void {
  if (typeof node === "string") {
    if (node.trim()) out.push({ path, value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectStringLeaves(item, [...path, i], out));
    return;
  }
  if (node && typeof node === "object") {
    for (const k of Object.keys(node as Record<string, unknown>)) {
      collectStringLeaves((node as Record<string, unknown>)[k], [...path, k], out);
    }
  }
}

/* -------------------------------------------------------------------------------------------- */
/* Contadores de observabilidad                                                                   */
/* -------------------------------------------------------------------------------------------- */

/**
 * Contadores del proceso. Sin esto era imposible responder "¿cuántas llamadas a Gemini hice hoy?"
 * sin abrir la consola de Google. Se exponen vía `GET /api/translate/stats` (protegido) para poder
 * vigilar las primeras horas tras el lanzamiento: si `geminiCalls` crece cuando nadie editó
 * contenido, hay una fuga.
 */
export const translateMetrics = {
  geminiCalls: 0,
  libreCalls: 0,
  engineFailures: 0,
  textsTranslated: 0,
  cacheHitsL1: 0,
  cacheHitsL2: 0,
  inFlightJoins: 0,
  startedAt: new Date().toISOString(),
};

/** Deadline global del fallback: LibreTranslate traduce en serie y puede colgar el request minutos. */
const LIBRE_FALLBACK_DEADLINE_MS = 8000;

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: deadline de ${ms}ms superado`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Fallback de `GeminiClient.translateJson`: mismo contrato (JSON in, JSON traducido out), vía
 * LibreTranslate.
 *
 * LANZA si LibreTranslate no tradujo absolutamente nada. Esto es deliberado y corrige un fallo
 * grave: `LibreTranslateService.translateMany` atrapa el error de cada texto y devuelve el
 * ORIGINAL EN ESPAÑOL sin lanzar. Como ese español no está vacío, el llamador lo tomaba por una
 * traducción legítima, lo marcaba `provider: "libretranslate"` y lo grababa en Mongo para siempre
 * — dejando la web en inglés llena de español, de forma indistinguible de una traducción real.
 * Si nada cambió, el motor está caído: hay que tratarlo como fallo, no como resultado.
 */
async function translateJsonViaLibreTranslate(obj: object): Promise<unknown> {
  const leaves: JsonLeaf[] = [];
  collectStringLeaves(obj, [], leaves);
  if (leaves.length === 0) return obj;

  const translated = await LibreTranslateService.translateMany(
    leaves.map((leaf) => leaf.value),
    "es",
    "en"
  );

  const changed = leaves.reduce((n, leaf, i) => n + (translated[i] !== leaf.value ? 1 : 0), 0);
  // Con 3+ textos, que NINGUNO cambie no es casualidad lingüística: es el motor caído.
  // Por debajo de eso sí puede pasar legítimamente (nombres propios sueltos), así que se acepta.
  if (leaves.length >= 3 && changed === 0) {
    throw new Error("LibreTranslate no devolvio ninguna traduccion (motor caido o mal configurado)");
  }

  const result = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  leaves.forEach((leaf, i) => {
    let cursor: any = result;
    for (let j = 0; j < leaf.path.length - 1; j++) cursor = cursor[leaf.path[j]];
    cursor[leaf.path[leaf.path.length - 1]] = translated[i];
  });
  return result;
}

/**
 * Llama al traductor sin pasar por ninguna caché. Gemini primero (mejor calidad); si falla (rate
 * limit, JSON truncado, etc.) cae a LibreTranslate antes de rendirse, para que una falla puntual
 * de Gemini no deje el contenido sin traducir.
 *
 * Devuelve también qué motor respondió, para dejarlo registrado en la caché persistente: así se
 * puede re-traducir más adelante solo lo que salió del motor peor, sin tocar lo bueno.
 */
async function translateJsonUncached(obj: object): Promise<{ value: any; provider: string }> {
  try {
    translateMetrics.geminiCalls += 1;
    return { value: await GeminiClient.translateJson(obj), provider: "gemini" };
  } catch (geminiError) {
    console.error("[TranslateService] Gemini fallo, cae a LibreTranslate:", geminiError);
    translateMetrics.libreCalls += 1;
    return {
      value: await withDeadline(
        translateJsonViaLibreTranslate(obj),
        LIBRE_FALLBACK_DEADLINE_MS,
        "LibreTranslate"
      ),
      provider: "libretranslate",
    };
  }
}

/* -------------------------------------------------------------------------------------------- */
/* Caché de dos niveles                                                                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * L1 — caché en memoria del proceso, indexada por el hash del TEXTO ORIGEN. Evita el viaje a Mongo
 * en las rutas calientes. Se pierde en cada redeploy de Railway; para eso está L2.
 *
 * L2 — colección `TranslationCache` en Mongo (ver `models/TranslationCache.ts`). Sobrevive a los
 * redeploys y a un eventual escalado horizontal.
 *
 * Ambas son content-addressed por el texto origen: si un admin edita el español, el hash cambia y
 * se traduce el texto nuevo solo. No hace falta invalidación activa ni un TTL corto — de ahí que
 * el TTL de L1 sea largo (antes eran 15 min, lo que re-traducía el MISMO contenido 96 veces al día
 * para siempre).
 */
const textCache = new Map<string, CacheEntry>();
const TEXT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días
const TEXT_CACHE_MAX_ENTRIES = 20_000;

/**
 * TTL corto para los textos que el motor NO supo traducir. No se persisten en L2: un fallo
 * transitorio (un 429 de Gemini de 30 segundos en el pico del lanzamiento) no debe quedar grabado
 * como si el texto fuera intraducible. Con este TTL se reintenta solo al cabo de unos minutos, sin
 * caer en el bucle de reintentar en CADA request.
 */
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;

/** Caché de lotes completos, solo para `translateJsonObject` (ruta de admin, no de visitante). */
const jsonCache = new Map<string, CacheEntry>();
const JSON_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JSON_CACHE_MAX_ENTRIES = 500;

/**
 * Traducciones en vuelo, por hash. Sin esto, N visitantes concurrentes que necesitan el MISMO
 * texto todavía no cacheado disparan N llamadas a Gemini: todos leen L1 vacío, todos leen L2
 * vacío, y la escritura solo ocurre cuando la primera respuesta vuelve. Medido en pruebas: 50
 * requests concurrentes en frío = 50 llamadas a Gemini por el mismo texto. Es exactamente el
 * escenario de un lanzamiento y el de cada redeploy de Railway.
 *
 * El reparto (quién traduce y quién espera) se hace de forma SÍNCRONA, antes de ceder el event
 * loop, que es lo único que garantiza que no se cuele nadie por el hueco.
 */
const inFlightByHash = new Map<string, Promise<string>>();

/** Tamaño de lote hacia el traductor: acota el riesgo de respuesta truncada por tope de tokens. */
const TRANSLATE_CHUNK_SIZE = 25;

const sha1 = (value: string): string => crypto.createHash("sha1").update(value).digest("hex");

const hashKey = (obj: object): string => sha1(JSON.stringify(obj));

/** Clave de una traducción individual. Incluye el par de idiomas para no colisionar entre sentidos. */
const buildTranslationHash = (text: string, sourceLang: string, targetLang: string): string =>
  sha1(`${sourceLang}:${targetLang}:${text}`);

/**
 * Barrido de vencidos amortizado: hacerlo en CADA inserción con la caché llena costaba ~49 ms de
 * event loop bloqueado por cada 200 entradas (se recorren 20 000). Se hace cada N inserciones.
 */
let writesSinceSweep = 0;
const SWEEP_EVERY_N_WRITES = 1000;

function evictIfNeeded(cache: Map<string, CacheEntry>, maxEntries: number, now: number): void {
  if (cache.size < maxEntries) return;

  writesSinceSweep += 1;
  if (writesSinceSweep >= SWEEP_EVERY_N_WRITES) {
    writesSinceSweep = 0;
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
    }
  }

  // `Map` conserva el orden de inserción, así que su primer elemento es el más antiguo.
  while (cache.size >= maxEntries) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

function readTextCache(hash: string, now: number): string | undefined {
  const hit = textCache.get(hash);
  if (!hit || hit.expiresAt <= now) return undefined;
  return typeof hit.value === "string" ? hit.value : undefined;
}

function writeTextCache(hash: string, value: string, now: number, ttlMs = TEXT_CACHE_TTL_MS): void {
  evictIfNeeded(textCache, TEXT_CACHE_MAX_ENTRIES, now);
  textCache.set(hash, { value, expiresAt: now + ttlMs });
}

const isDbReady = (): boolean => mongoose.connection.readyState === 1;

/**
 * Lee de L2 (Mongo) en UNA sola consulta por lote. Best-effort: si Mongo no está listo o la
 * consulta falla, se devuelve vacío y el flujo cae al traductor — nunca rompe el request.
 */
async function readPersistentCache(hashes: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (hashes.length === 0 || !isDbReady()) return found;

  try {
    const docs = await TranslationCache.find({ hash: { $in: hashes } })
      .select({ hash: 1, translatedText: 1 })
      .lean();

    for (const doc of docs) {
      if (typeof doc?.hash === "string" && typeof doc?.translatedText === "string") {
        found.set(doc.hash, doc.translatedText);
      }
    }
  } catch (error) {
    console.error("[TranslateService.readPersistentCache] fallo la lectura de cache:", error);
  }

  return found;
}

/**
 * Escribe en L2. `upsert` para que dos requests concurrentes con el mismo texto no choquen contra
 * el índice único. Best-effort por la misma razón que la lectura: un fallo acá no debe tumbar una
 * respuesta que ya está traducida y lista para enviarse.
 *
 * Solo se llama con traducciones BUENAS: lo que el motor no supo traducir no llega hasta acá (ver
 * `NEGATIVE_CACHE_TTL_MS`), para no grabar español como si fuera inglés ni pisar una traducción
 * correcta que ya estuviera guardada.
 */
async function writePersistentCache(
  entries: Array<{ hash: string; sourceText: string; translatedText: string; provider: string }>,
  sourceLang: string,
  targetLang: string
): Promise<void> {
  if (entries.length === 0 || !isDbReady()) return;

  try {
    await TranslationCache.bulkWrite(
      entries.map((e) => ({
        updateOne: {
          filter: { hash: e.hash },
          update: {
            $set: {
              sourceText: e.sourceText,
              translatedText: e.translatedText,
              sourceLang,
              targetLang,
              provider: e.provider,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error) {
    console.error("[TranslateService.writePersistentCache] fallo la escritura de cache:", error);
  }
}

type FieldSpec<T> = keyof T;

export const TranslateService = {
  /** Contadores de uso del traductor (para `GET /api/translate/stats`). */
  getMetrics() {
    return {
      ...translateMetrics,
      l1Size: textCache.size,
      inFlight: inFlightByHash.size,
    };
  },

  /**
   * Traduce un objeto JSON completo de una sola vez (ruta de admin: guardar una sección de la
   * landing desde el dashboard). Cachea por hash del objeto entero, que acá SÍ tiene sentido
   * porque el objeto es estable — lo dispara un guardado, no una visita.
   *
   * Si ambos motores fallan devuelve el objeto SIN traducir en vez de lanzar: el llamador guarda
   * el español y el frontend cae a su diccionario de respaldo. Antes la excepción subía hasta el
   * controlador y el admin recibía un 500 al guardar la landing.
   */
  async translateJsonObject(obj: object): Promise<any> {
    const key = hashKey(obj);
    const now = Date.now();
    const cached = jsonCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    let value: any;
    try {
      value = (await translateJsonUncached(obj)).value;
    } catch (error) {
      translateMetrics.engineFailures += 1;
      console.error("[TranslateService.translateJsonObject] ningun motor pudo traducir:", error);
      return obj;
    }

    evictIfNeeded(jsonCache, JSON_CACHE_MAX_ENTRIES, now);
    jsonCache.set(key, { value, expiresAt: now + JSON_CACHE_TTL_MS });
    return value;
  },

  /**
   * Traduce (es -> en) una lista plana de textos. Esta es LA ruta caliente: la recorren todas las
   * visitas en inglés a habitaciones, áreas, reseñas, retiros y full days.
   *
   * Cachea POR TEXTO, no por lote. Es la diferencia entre pagarle a Gemini una vez por texto en la
   * vida del contenido, y pagarle una vez por búsqueda de usuario: antes la clave era el hash del
   * lote completo, y como el lote de `/api/rooms/show` cambia con el rango de fechas que busca
   * cada visitante, prácticamente nunca había un acierto de caché.
   *
   * Best-effort en todo el recorrido: un texto que no vuelve traducido se devuelve tal cual.
   */
  async translateManySpanishToEnglish(texts: string[]): Promise<string[]> {
    if (texts.length === 0) return texts;

    const now = Date.now();
    const result = new Array<string>(texts.length);
    const hashByText = new Map<string, string>();
    const pendingTexts = new Set<string>();

    // 1. L1 (memoria). Se resuelve lo que se pueda sin salir del proceso.
    texts.forEach((text, i) => {
      if (typeof text !== "string" || !text.trim()) {
        // Un no-string no puede traducirse; se devuelve "" para respetar la firma `string[]`
        // (antes salía `undefined` y se colaba en la respuesta JSON).
        result[i] = typeof text === "string" ? text : "";
        return;
      }

      let hash = hashByText.get(text);
      if (!hash) {
        hash = buildTranslationHash(text, "es", "en");
        hashByText.set(text, hash);
      }

      const hit = readTextCache(hash, now);
      if (hit !== undefined) {
        translateMetrics.cacheHitsL1 += 1;
        result[i] = hit;
      } else {
        pendingTexts.add(text);
      }
    });

    if (pendingTexts.size === 0) return result;

    const resolved = new Map<string, string>();

    // 2. Reparto SÍNCRONO entre "yo traduzco" y "me engancho al que ya está traduciendo".
    //    Tiene que ocurrir antes del primer `await`, o se abre el hueco del stampede.
    const owned: string[] = [];
    const joiners: Array<{ text: string; promise: Promise<string> }> = [];
    const settlers = new Map<string, (value: string) => void>();

    for (const text of pendingTexts) {
      const hash = hashByText.get(text) as string;
      const existing = inFlightByHash.get(hash);
      if (existing) {
        translateMetrics.inFlightJoins += 1;
        joiners.push({ text, promise: existing });
        continue;
      }
      owned.push(text);
      inFlightByHash.set(
        hash,
        new Promise<string>((resolve) => settlers.set(text, resolve))
      );
    }

    try {
      if (owned.length > 0) {
        // 3. L2 (Mongo). Una sola consulta para todo lo propio; sobrevive a los redeploys.
        const persisted = await readPersistentCache(owned.map((t) => hashByText.get(t) as string));

        const stillPending: string[] = [];
        for (const text of owned) {
          const hash = hashByText.get(text) as string;
          const fromDb = persisted.get(hash);
          if (fromDb !== undefined) {
            translateMetrics.cacheHitsL2 += 1;
            resolved.set(text, fromDb);
            writeTextCache(hash, fromDb, now); // promueve a L1
          } else {
            stillPending.push(text);
          }
        }

        // 4. Traductor. Solo lo que no estaba en ninguna de las dos cachés, en lotes acotados.
        for (let start = 0; start < stillPending.length; start += TRANSLATE_CHUNK_SIZE) {
          const chunk = stillPending.slice(start, start + TRANSLATE_CHUNK_SIZE);

          const payload: Record<string, string> = {};
          chunk.forEach((text, i) => {
            payload[String(i)] = text;
          });

          let translated: any;
          let provider = "gemini";
          try {
            const out = await translateJsonUncached(payload);
            translated = out.value;
            provider = out.provider;
          } catch (error) {
            translateMetrics.engineFailures += 1;
            console.error("[TranslateService.translateManySpanishToEnglish] traductor fallo:", error);
            translated = undefined;
          }

          const pick = (i: number): string | undefined => {
            const raw = translated?.[String(i)];
            return typeof raw === "string" && raw.trim() ? raw : undefined;
          };

          const hits = chunk.reduce((n, _t, i) => n + (pick(i) !== undefined ? 1 : 0), 0);
          if (hits < chunk.length) {
            console.error("[TranslateService] el motor devolvio menos textos de los enviados", {
              enviados: chunk.length,
              recibidos: hits,
              provider,
            });
          }

          const toPersist: Array<{ hash: string; sourceText: string; translatedText: string; provider: string }> = [];

          chunk.forEach((text, i) => {
            const clean = pick(i);
            const hash = hashByText.get(text) as string;
            const value = clean ?? text;
            resolved.set(text, value);

            if (clean !== undefined) {
              translateMetrics.textsTranslated += 1;
              writeTextCache(hash, value, now);
              toPersist.push({ hash, sourceText: text, translatedText: value, provider });
            } else {
              // Fallo del motor: TTL corto en L1 y NADA en L2. Así no se reintenta en cada
              // request (bucle) pero tampoco queda grabado para siempre como intraducible.
              writeTextCache(hash, value, now, NEGATIVE_CACHE_TTL_MS);
            }
          });

          // No se espera: la respuesta ya está lista y el visitante no debe pagar la latencia de
          // escribir la caché. Los errores se registran dentro de `writePersistentCache`.
          void writePersistentCache(toPersist, "es", "en");
        }
      }
    } finally {
      // Liberar SIEMPRE, incluso si algo lanzó: si no, los que esperan quedan colgados para siempre.
      for (const text of owned) {
        const hash = hashByText.get(text) as string;
        settlers.get(text)?.(resolved.get(text) ?? text);
        inFlightByHash.delete(hash);
      }
    }

    // 5. Esperar a los textos que estaba traduciendo otro request concurrente.
    for (const joiner of joiners) {
      resolved.set(joiner.text, await joiner.promise);
    }

    texts.forEach((text, i) => {
      if (result[i] === undefined) {
        result[i] = resolved.get(text as string) ?? (typeof text === "string" ? text : "");
      }
    });

    return result;
  },

  /**
   * Backfill persistente: para los items donde `targetField` está vacío y `sourceField` (string)
   * no, traduce y ESCRIBE en `targetField` (en memoria — el caller decide cómo persistir: un
   * `doc.save()`, un `bulkWrite`, etc., porque cada modelo lo hace distinto). No pisa nada que ya
   * tenga traducción — así un admin puede corregir `targetField` a mano sin que se lo vuelvan a
   * pisar. Devuelve solo los items que sí se tradujeron, para que el caller sepa qué persistir.
   */
  async backfillEnglishField<T extends Record<string, unknown>>(
    items: T[],
    sourceField: FieldSpec<T>,
    targetField: FieldSpec<T>
  ): Promise<T[]> {
    const missing = items.filter((it) => {
      const src = it[sourceField];
      return typeof src === "string" && src.trim() && !it[targetField];
    });
    if (missing.length === 0) return [];

    const texts = missing.map((it) => it[sourceField] as string);
    const translated = await this.translateManySpanishToEnglish(texts);

    // No comparar contra el texto original: hay nombres propios y palabras que Gemini
    // devuelve intactos a propósito (p. ej. «Yoga», «Old Yanashpa»). Si se excluyen de
    // `changed` por "no cambiaron", nunca se persisten y quedan como "pendientes" para
    // siempre — cada visita en inglés vuelve a pedirle la traducción a Gemini/LibreTranslate
    // para ese mismo ítem, lo que hacía lentas TODAS las cargas en inglés indefinidamente.
    //
    // Por la misma razón se persiste el ORIGINAL cuando la traducción vuelve vacía: antes esos
    // items no entraban en `changed`, así que seguían con `targetField` vacío y volvían a caer
    // en `missing` en el request siguiente, en bucle.
    const changed: T[] = [];
    missing.forEach((it, i) => {
      const t = translated[i]?.trim();
      (it as Record<string, unknown>)[targetField as string] = t || (it[sourceField] as string);
      changed.push(it);
    });

    return changed;
  },

  /**
   * Igual que `backfillEnglishField`, pero para un campo `string[]` (p. ej. `actividadesDelDia`)
   * traducido a otro campo `string[]` paralelo. Un item se considera pendiente si `sourceField`
   * tiene contenido y `targetField` todavía no es un array.
   */
  async backfillEnglishArrayField<T extends Record<string, unknown>>(
    items: T[],
    sourceField: FieldSpec<T>,
    targetField: FieldSpec<T>
  ): Promise<T[]> {
    const missing = items.filter((it) => {
      const src = it[sourceField];
      return Array.isArray(src) && src.length > 0 && !Array.isArray(it[targetField]);
    });
    if (missing.length === 0) return [];

    // Se aplana a una lista de textos (en vez de armar un objeto `{i_j: texto}` para
    // `translateJsonObject`) para que pase por la caché POR TEXTO de
    // `translateManySpanishToEnglish`: con el objeto indexado por posición, la clave de caché
    // dependía del lote entero y casi nunca acertaba.
    const flat: string[] = [];
    const spans: Array<{ start: number; length: number }> = [];

    for (const it of missing) {
      const src = it[sourceField] as unknown as string[];
      const start = flat.length;
      for (const text of src) flat.push(typeof text === "string" ? text : "");
      spans.push({ start, length: src.length });
    }

    const changed: T[] = [];
    try {
      const translated = await this.translateManySpanishToEnglish(flat);
      missing.forEach((it, i) => {
        const { start, length } = spans[i];
        const src = it[sourceField] as unknown as string[];
        const out = Array.from({ length }, (_, j) => {
          const t = translated[start + j];
          if (typeof t === "string" && t.trim()) return t;
          // El destino es `[String]` en Mongo: un no-string acá provoca un CastError que tumba
          // el bulkWrite entero del caller.
          return typeof src[j] === "string" ? src[j] : "";
        });
        (it as Record<string, unknown>)[targetField as string] = out;
        changed.push(it);
      });
    } catch (error) {
      console.error("[TranslateService.backfillEnglishArrayField] fallo la traduccion:", error);
    }

    return changed;
  },

  /**
   * Arma las operaciones `bulkWrite` para persistir un campo recién traducido (salida de
   * `backfillEnglishField`/`backfillEnglishArrayField`) de vuelta en su documento Mongo por `_id`.
   */
  buildSetOps<T extends { _id: unknown }>(items: T[], field: FieldSpec<T>): any[] {
    return items.map((it) => ({
      updateOne: {
        filter: { _id: it._id },
        update: { $set: { [field as string]: it[field] } },
      },
    }));
  },
};
