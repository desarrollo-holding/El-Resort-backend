export type LibreTranslateConfig = {
  baseUrl: string;
  timeoutMs: number;
  apiKey?: string;
  delayMs: number;
};

const normalizeBaseUrl = (value: string): string => {
  const trimmed = (value || "").trim();
  if (!trimmed) throw new Error("LIBRETRANSLATE_BASE_URL es requerido");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("LIBRETRANSLATE_BASE_URL debe ser una URL valida");
  }

  if (!url.protocol || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("LIBRETRANSLATE_BASE_URL debe usar http o https");
  }

  // Strip trailing slash for consistent concatenation
  return url.toString().replace(/\/+$/, "");
};

export const getLibreTranslateConfigFromEnv = (): LibreTranslateConfig => {
  const baseUrl = normalizeBaseUrl(process.env.LIBRETRANSLATE_BASE_URL || "http://localhost:5000");
  const timeoutMs = Number(process.env.LIBRETRANSLATE_TIMEOUT_MS || 15000);
  const delayMs = Number(process.env.LIBRETRANSLATE_DELAY_MS || 0);
  const apiKeyRaw = (process.env.LIBRETRANSLATE_API_KEY || "").trim();

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("LIBRETRANSLATE_TIMEOUT_MS debe ser un numero > 0");
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("LIBRETRANSLATE_DELAY_MS debe ser un numero >= 0");
  }

  return {
    baseUrl,
    timeoutMs,
    delayMs,
    apiKey: apiKeyRaw ? apiKeyRaw : undefined,
  };
};
