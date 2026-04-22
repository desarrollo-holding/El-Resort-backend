declare module '@google/genai' {
  export enum ThinkingLevel {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
  }

  export type GenerateContentStreamArgs = {
    model: string;
    config?: any;
    contents: Array<any>;
  };

  export type ContentChunk = {
    text?: string;
    // allow other possible fields
    [key: string]: any;
  };

  export class GoogleGenAI {
    constructor(opts: { apiKey: string });
    models: {
      generateContentStream(args: GenerateContentStreamArgs): AsyncIterable<ContentChunk>;
    };
  }

  export default GoogleGenAI;
}
