import crypto from "crypto";
import { GeminiClient } from "../integrations/geminiClient";
import { LibreTranslateService } from "./libreTranslate.service";

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

/** Fallback de `GeminiClient.translateJson`: mismo contrato (JSON in, JSON traducido out), vía LibreTranslate. */
async function translateJsonViaLibreTranslate(obj: object): Promise<unknown> {
  const leaves: JsonLeaf[] = [];
  collectStringLeaves(obj, [], leaves);
  if (leaves.length === 0) return obj;

  const translated = await LibreTranslateService.translateMany(
    leaves.map((leaf) => leaf.value),
    "es",
    "en"
  );

  const result = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  leaves.forEach((leaf, i) => {
    let cursor: any = result;
    for (let j = 0; j < leaf.path.length - 1; j++) cursor = cursor[leaf.path[j]];
    cursor[leaf.path[leaf.path.length - 1]] = translated[i];
  });
  return result;
}

/**
 * Cache en memoria del proceso: sin esto, cada visita a una página pública (reviews, áreas,
 * retiros...) dispararía una llamada a Gemini por cada texto, para el mismo contenido una y
 * otra vez. TTL corto porque el contenido lo edita un admin desde el dashboard y no hay
 * invalidación activa al guardar — 15 min es un balance entre "no golpear Gemini en cada visita"
 * y "que un cambio reciente no tarde demasiado en reflejarse".
 */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

const hashKey = (obj: object): string => crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex");

type FieldSpec<T> = keyof T;

export const TranslateService = {
  /**
   * Gemini como traductor principal (mejor calidad); si falla (rate limit, JSON truncado, etc.)
   * cae a LibreTranslate antes de rendirse, para que una falla puntual de Gemini no deje el
   * contenido sin traducir.
   */
  async translateJsonObject(obj: object): Promise<any> {
    const key = hashKey(obj);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    let translated: unknown;
    try {
      translated = await GeminiClient.translateJson(obj);
    } catch (geminiError) {
      console.error("[TranslateService.translateJsonObject] Gemini fallo, cae a LibreTranslate:", geminiError);
      translated = await translateJsonViaLibreTranslate(obj);
    }

    cache.set(key, { value: translated, expiresAt: now + CACHE_TTL_MS });
    return translated;
  },

  /**
   * Traduce (es -> en, vía Gemini, con cache) una lista plana de textos, en una sola llamada.
   * Mismo contrato que el `LibreTranslateService.translateManySpanishToEnglish` que reemplaza:
   * best-effort, un texto que no vuelve traducido se devuelve tal cual.
   */
  async translateManySpanishToEnglish(texts: string[]): Promise<string[]> {
    if (texts.length === 0) return texts;

    const payload: Record<string, string> = {};
    texts.forEach((text, i) => {
      payload[String(i)] = text;
    });

    try {
      const translated = await this.translateJsonObject(payload);
      return texts.map((original, i) => {
        const t = translated?.[String(i)];
        return typeof t === "string" && t.trim() ? t : original;
      });
    } catch (error) {
      console.error("[TranslateService.translateManySpanishToEnglish] Gemini fallo, se deja el texto original:", error);
      return texts;
    }
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

    const changed: T[] = [];
    missing.forEach((it, i) => {
      const t = translated[i]?.trim();
      if (t && t !== texts[i]) {
        (it as Record<string, unknown>)[targetField as string] = t;
        changed.push(it);
      }
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

    const payload: Record<string, string> = {};
    missing.forEach((it, i) => {
      (it[sourceField] as unknown as string[]).forEach((text, j) => {
        if (typeof text === "string" && text.trim()) payload[`${i}_${j}`] = text;
      });
    });

    const changed: T[] = [];
    try {
      const translated = await this.translateJsonObject(payload);
      missing.forEach((it, i) => {
        const src = it[sourceField] as unknown as string[];
        const result = src.map((text, j) => {
          const t = translated?.[`${i}_${j}`];
          return typeof t === "string" && t.trim() ? t : text;
        });
        (it as Record<string, unknown>)[targetField as string] = result;
        changed.push(it);
      });
    } catch (error) {
      console.error("[TranslateService.backfillEnglishArrayField] Gemini fallo, se deja el texto original:", error);
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
