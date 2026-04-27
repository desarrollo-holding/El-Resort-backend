import axios, { type AxiosInstance } from "axios";
import { getLibreTranslateConfigFromEnv, type LibreTranslateConfig } from "../config/libretranslate";

export type LibreTranslateTranslateRequest = {
  q: string;
  source: string;
  target: string;
  format?: "html";
};

export type LibreTranslateTranslateResponse = {
  translatedText: string;
};

let cached: { config: LibreTranslateConfig; client: AxiosInstance } | null = null;

const buildClient = (config: LibreTranslateConfig): AxiosInstance => {
  return axios.create({
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    headers: {
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });
};

export const getCachedLibreTranslateClientFromEnv = (): { config: LibreTranslateConfig; client: AxiosInstance } => {
  const config = getLibreTranslateConfigFromEnv();

  if (!cached || cached.config.baseUrl !== config.baseUrl || cached.config.timeoutMs !== config.timeoutMs || cached.config.apiKey !== config.apiKey) {
    cached = { config, client: buildClient(config) };
  }

  return cached;
};

export const LibreTranslateClient = {
  async translateText(input: LibreTranslateTranslateRequest): Promise<LibreTranslateTranslateResponse> {
    const { client, config } = getCachedLibreTranslateClientFromEnv();

    const payload: Record<string, unknown> = {
      q: input.q,
      source: input.source,
      target: input.target,
      format: input.format ?? "html",
    };

    if (config.apiKey) {
      // Some LibreTranslate deployments require api_key
      payload.api_key = config.apiKey;
    }

    const res = await client.post("/translate", payload);

    if (res.status < 200 || res.status >= 300) {
      const message = typeof (res.data as any)?.error === "string" ? (res.data as any).error : "LibreTranslate error";
      const err = new Error(`${message} (status ${res.status})`);
      (err as any).status = res.status;
      (err as any).data = res.data;
      throw err;
    }

    const translatedText = (res.data as any)?.translatedText;
    if (typeof translatedText !== "string") {
      throw new Error("Respuesta invalida de LibreTranslate: falta translatedText");
    }

    return { translatedText };
  },
};
