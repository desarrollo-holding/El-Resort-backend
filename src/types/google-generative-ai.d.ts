declare module '@google/generative-ai' {
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
    [key: string]: any;
  };

  export class GoogleGenAI {
    constructor(opts: { apiKey: string });
    models: {
      generateContentStream(args: GenerateContentStreamArgs): AsyncIterable<ContentChunk>;
    };
  }

  export { GoogleGenAI, ThinkingLevel };
  export default GoogleGenAI;
}
