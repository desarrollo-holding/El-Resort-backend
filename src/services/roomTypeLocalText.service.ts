import { TranslateService } from "./translate.service";

/**
 * Traducción es→en compartida por los campos locales traducibles de una propiedad
 * (nombre, descripción). Mismo contrato que `BeneficiosService.resolveNombreEn`:
 * el inglés se resuelve una sola vez al guardar, no en cada lectura, así el admin
 * puede corregir la traducción después sin que se le vuelva a pisar. Si el traductor
 * falla, se queda en `null` y el consumidor cae al respaldo (español, u otra fuente).
 */
export class RoomTypeLocalTextService {
  static async resolveEnglishText(es: string, manualEn?: string | null): Promise<string | null> {
    const manual = (manualEn ?? "").trim();
    if (manual) return manual;
    if (!es.trim()) return null;

    try {
      const [translated] = await TranslateService.translateManySpanishToEnglish([es]);
      const clean = (translated ?? "").trim();
      return clean && clean !== es ? clean : null;
    } catch (error) {
      console.error("[RoomTypeLocalTextService.resolveEnglishText]", error);
      return null;
    }
  }
}
