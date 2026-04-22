/* eslint-disable @typescript-eslint/no-var-requires */
const genai: any = require('@google/genai');
import { getGeminiConfigFromEnv } from '../config/gemini';

export const GeminiClient = {
  async translateJson(inputObj: object): Promise<any> {
    const cfg = getGeminiConfigFromEnv();

    // Use the original @google/genai exports
    const GoogleGenAI = genai?.GoogleGenAI ?? genai?.default ?? genai;
    const ThinkingLevel = genai?.ThinkingLevel ?? genai?.ThinkingLevel ?? { HIGH: 'HIGH' };

    if (typeof GoogleGenAI !== 'function') {
      console.error('@@ GoogleGenAI constructor not found in @google/genai exports:', Object.keys(genai || {}));
      throw new Error('GoogleGenAI constructor not found in @google/genai');
    }

    // Log raw API key (requested) and environment for diagnosis
    try {
      const rawKey = process.env.GEMINI_API_KEY;
      console.log('@@ Using GEMINI_API_KEY (raw):', rawKey);
      console.log('@@ NODE_ENV:', process.env.NODE_ENV);
    } catch (e) {
      console.error('@@ failed reading GEMINI_API_KEY', e);
    }

    const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
    // Runtime diagnostics: inspect the `ai` object shape
    try {
      console.log('@@ ai keys:', ai && Object.keys(ai));
      console.log('@@ ai.models exists:', !!ai?.models);
      console.log('@@ ai.models keys:', ai?.models ? Object.keys(ai.models) : undefined);
      console.log('@@ typeof ai.models.generateContentStream:', typeof ai?.models?.generateContentStream);
      const listModels = await ai.models.list();
      console.log('@@ Modelos disponibles:', JSON.stringify(listModels, null, 2));
    } catch (e) {
      console.error('@@ failed to inspect ai object', e);
    }

    // Validate the streaming API exists
    if (!ai?.models || typeof ai.models.generateContentStream !== 'function') {
      console.error('@@ generateContentStream not available on ai.models. Full ai snapshot:', ai);
      throw new Error('generateContentStream no disponible en el cliente Gemini instanciado. Revisa la API del paquete @google/genai');
    }

    const tools = [
    ];

    const config = {
      temperature: 0,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },
      tools,
      systemInstruction: [
        {
          text: `Eres un experto traductor técnico. Tu entrada será un objeto JSON. Tu tarea es traducir los valores de texto al idioma inglés.
Reglas críticas:

Mantén exactamente las mismas llaves (keys) del JSON.

Mantén todas las etiquetas HTML (<b>, <i>, <span>, etc.) intactas y en su posición correcta dentro del texto traducido.

No traduzcas nombres propios si el contexto no lo requiere.

Devuelve ÚNICAMENTE el JSON traducido, sin explicaciones ni bloques de código Markdown.

IMPORTANTE: Tu respuesta debe ser ÚNICAMENTE el objeto JSON traducido. No incluyas texto antes ni después, ni uses bloques de código con \`\`\`json. Solo el contenido del objeto.`,
        },
      ],
    } as const;

    const model = cfg.model as string;
    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: JSON.stringify(inputObj),
          },
        ],
      },
    ];

    let response: AsyncIterable<any>;
    try {
      response = await ai.models.generateContentStream({ model, config, contents });
    } catch (err: any) {
      // include raw key and full error for diagnosis
      const rawKey = process.env.GEMINI_API_KEY;
      console.error('@@ generateContentStream threw an error. GEMINI_API_KEY (raw):', rawKey);
      console.error('@@ generateContentStream error object:', err);
      // if error has response/body, log it
      try {
        if (err?.response) console.error('@@ err.response:', err.response);
        if (err?.body) console.error('@@ err.body:', err.body);
        if (err?.message) console.error('@@ err.message:', err.message);
      } catch (e) {
        console.error('@@ failed logging nested error fields', e);
      }
      throw err;
    }

    let output = '';
    for await (const chunk of response) {
      if ((chunk as any).text) {
        output += (chunk as any).text;
      }
    }

    // Try to parse the assistant output as JSON. Strip code fences if present.
    const cleaned = output.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try {
      // dump raw output for diagnosis
      console.log('@@ raw assistant output:', output);
      return JSON.parse(cleaned);
    } catch (err) {
      console.error('@@ failed to parse assistant output. cleaned:', cleaned);
      throw new Error('Gemini response is not valid JSON: ' + cleaned);
    }
  }
};
