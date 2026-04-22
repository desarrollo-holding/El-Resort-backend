export type GeminiConfig = {
  apiKey: string;
  model: string;
  temperature: number;
};

export const getGeminiConfigFromEnv = (): GeminiConfig => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required');
  }

  const model = (process.env.GEMINI_MODEL || 'gemini-flash-latest').trim();
  const temperatureRaw = process.env.GEMINI_TEMPERATURE;
  const temperature = Number.isFinite(Number(temperatureRaw))
    ? Number(temperatureRaw)
    : 0;

  return {
    apiKey,
    model,
    temperature,
  };
};
