import { GeminiClient } from "../integrations/geminiClient";

export const TranslateService = {
  async translateJsonObject(obj: object): Promise<any> {
    return GeminiClient.translateJson(obj);
  },
};
