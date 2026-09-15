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
      // No se descarta una traducción por ser idéntica al original: los nombres propios
      // («Yanashpa», «Gaia») vuelven intactos a propósito. Descartarlos dejaba el campo `en` en
      // `null` para siempre, así que cada lectura en inglés volvía a pedir esa traducción — el
      // mismo bucle que ya está documentado en `TranslateService.backfillEnglishField`.
      return clean || null;
    } catch (error) {
      console.error("[RoomTypeLocalTextService.resolveEnglishText]", error);
      return null;
    }
  }
}
