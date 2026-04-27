import { translate } from "@vitalets/google-translate-api";
import { getTranslateConfigFromEnv } from "../config/translate";

const sleep = (ms: number): Promise<void> => {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safeMs === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, safeMs));
};

export const GoogleTranslateService = {
  async translateSpanishToEnglish(text: string): Promise<string> {
    const normalizedText = typeof text === "string" ? text : String(text);
    const trimmed = normalizedText.trim();
    if (!trimmed) return normalizedText;

    const config = getTranslateConfigFromEnv();

    const response = await translate(trimmed, {
      from: "es",
      to: "en",
      host: config.host,
      fetchOptions: {
        signal: AbortSignal.timeout(config.timeoutMs),
      },
    });

    return response.text;
  },

  async translateManySpanishToEnglish(texts: string[], opts?: { delayMs?: number }): Promise<string[]> {
    // Opción B: "enfriar" peticiones.
    // Traducimos en serie y opcionalmente esperamos entre requests.
    const delayMs = opts?.delayMs ?? 250;

    const results: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];

      try {
        results.push(await this.translateSpanishToEnglish(text));
      } catch (error) {
        // Best-effort: si Google Translate falla para un texto, devolvemos el original.
        console.warn("@@ GoogleTranslateService failed for a text; returning original:", error);
        results.push(text);
      }

      // No dormir después del último.
      if (i < texts.length - 1) {
        await sleep(delayMs);
      }
    }

    return results;
  },
};
