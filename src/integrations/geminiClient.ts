/* eslint-disable @typescript-eslint/no-var-requires */
const genai: any = require('@google/genai');
import { getGeminiConfigFromEnv } from '../config/gemini';

export const GeminiClient = {
  async translateJson(inputObj: object): Promise<any> {
    const cfg = getGeminiConfigFromEnv();

    // Use the original @google/genai exports
    const GoogleGenAI = genai?.GoogleGenAI ?? genai?.default ?? genai;
    const ThinkingLevel = genai?.ThinkingLevel ?? { MINIMAL: 'MINIMAL', LOW: 'LOW' };
    // Los tokens de "pensamiento" se facturan como output. Traducir con temperature 0 es una
    // tarea mecánica que no los necesita, así que se pide el nivel mínimo disponible: MINIMAL si
    // la versión instalada del SDK lo expone, LOW como respaldo.
    const thinkingLevel = ThinkingLevel.MINIMAL ?? ThinkingLevel.LOW ?? 'LOW';

    if (typeof GoogleGenAI !== 'function') {
      throw new Error('GoogleGenAI constructor not found in @google/genai');
    }

    const ai = new GoogleGenAI({ apiKey: cfg.apiKey });

    // Validate the streaming API exists
    if (!ai?.models || typeof ai.models.generateContentStream !== 'function') {
      throw new Error('generateContentStream no disponible en el cliente Gemini instanciado. Revisa la API del paquete @google/genai');
    }

    const tools: unknown[] = [];

    const config = {
      // `GEMINI_TEMPERATURE` estaba documentada en .env.example pero no se usaba: el valor
      // estaba escrito a mano acá, así que cambiar la variable no hacía nada.
      temperature: cfg.temperature,
      thinkingConfig: {
        thinkingLevel,
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
      console.error('[GeminiClient.translateJson] generateContentStream failed:', err?.message ?? err);
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
      return JSON.parse(cleaned);
    } catch (err) {
      throw new Error('Gemini response is not valid JSON: ' + cleaned);
    }
  }
};
