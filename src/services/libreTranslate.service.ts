import { getLibreTranslateConfigFromEnv } from "../config/libretranslate";
import { LibreTranslateClient } from "../integrations/libreTranslateClient";

const sleep = (ms: number): Promise<void> => {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safeMs === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, safeMs));
};

export const LibreTranslateService = {
  async translate(text: string, source: "es" | "en", target: "es" | "en"): Promise<string> {
    const normalizedText = typeof text === "string" ? text : String(text);
    const trimmed = normalizedText.trim();
    if (!trimmed) return normalizedText;

    const { translatedText } = await LibreTranslateClient.translateText({
      q: trimmed,
      source,
      target,
      format: "html",
    });

    return translatedText;
  },

  async translateMany(texts: string[], source: "es" | "en", target: "es" | "en"): Promise<string[]> {
    const cfg = getLibreTranslateConfigFromEnv();
    const results: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];

      try {
        results.push(await this.translate(text, source, target));
      } catch (error) {
        // Best-effort: si LibreTranslate falla para un texto, devolvemos el original.
        console.warn("@@ LibreTranslateService failed for a text; returning original:", error);
        results.push(text);
      }

      if (i < texts.length - 1) {
        await sleep(cfg.delayMs);
      }
    }

    return results;
  },

  async translateManySpanishToEnglish(texts: string[]): Promise<string[]> {
    return this.translateMany(texts, "es", "en");
  },
};
