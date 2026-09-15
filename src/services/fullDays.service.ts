import FullDay from "../models/FullDays";
import { TranslateService } from "./translate.service";
import type { Idioma } from "../utils/idioma";

type CreateFullDayInput = {
  nombre: string;
  descripcion: string;
  idealPara: string;
  cuposMaximos: number;
  imagen: string;
  incluye: string[];
  itinerario: string[];
  precioPorPersona: number;
  disponible: boolean;
  fechaRegistro?: Date;
};

export const FullDaysService = {
  async create(data: Partial<CreateFullDayInput>) {
    const created = await FullDay.create(data);
    return created;
  },

  async listAll(idioma: Idioma = "es") {
    // Sin fechas de vigencia, el orden estable es el de creación: la lista no se reacomoda sola.
    const fullDays = await FullDay.find({}).sort({ fechaRegistro: 1 }).lean();

    if (idioma === "en") {
      const [changedNombre, changedDescripcion, changedIdealPara, changedIncluye, changedItinerario] = await Promise.all([
        TranslateService.backfillEnglishField(fullDays, "nombre", "nombreEn"),
        TranslateService.backfillEnglishField(fullDays, "descripcion", "descripcionEn"),
        TranslateService.backfillEnglishField(fullDays, "idealPara", "idealParaEn"),
        TranslateService.backfillEnglishArrayField(fullDays, "incluye", "incluyeEn"),
        TranslateService.backfillEnglishArrayField(fullDays, "itinerario", "itinerarioEn"),
      ]);

      const ops = [
        ...TranslateService.buildSetOps(changedNombre, "nombreEn"),
        ...TranslateService.buildSetOps(changedDescripcion, "descripcionEn"),
        ...TranslateService.buildSetOps(changedIdealPara, "idealParaEn"),
        ...TranslateService.buildSetOps(changedIncluye, "incluyeEn"),
        ...TranslateService.buildSetOps(changedItinerario, "itinerarioEn"),
      ];
      // La persistencia es best-effort a propósito: si el bulkWrite falla, la respuesta YA está
      // traducida en memoria y el visitante la recibe igual. Dejarlo sin capturar convertía un
      // fallo de escritura en un 500 permanente para toda la web en inglés.
      if (ops.length > 0) {
        try {
          await FullDay.bulkWrite(ops, { ordered: false });
        } catch (error) {
          console.error("[FullDay] no se pudo persistir la traduccion al ingles:", error);
        }
      }
    }

    return idioma === "en"
      ? fullDays.map((f) => ({
          ...f,
          nombre: f.nombreEn || f.nombre,
          descripcion: f.descripcionEn || f.descripcion,
          idealPara: f.idealParaEn || f.idealPara,
          incluye: f.incluyeEn ?? f.incluye,
          itinerario: f.itinerarioEn ?? f.itinerario,
        }))
      : fullDays;
  },

  async getById(id: string) {
    return FullDay.findById(id);
  },

  async updateById(id: string, data: Partial<CreateFullDayInput>) {
    const current = await FullDay.findById(id);
    if (!current) return null;

    // Traducciones cacheadas por el server: nunca se aceptan del cliente, y se invalidan si su
    // fuente en español cambió, para que se regeneren solas en la próxima visita con idioma=en.
    const patch: Record<string, unknown> = { ...data };
    delete patch.nombreEn;
    delete patch.descripcionEn;
    delete patch.idealParaEn;
    delete patch.incluyeEn;
    delete patch.itinerarioEn;

    if (typeof data.nombre === "string" && data.nombre !== current.nombre) patch.nombreEn = null;
    if (typeof data.descripcion === "string" && data.descripcion !== current.descripcion) patch.descripcionEn = null;
    if (typeof data.idealPara === "string" && data.idealPara !== current.idealPara) patch.idealParaEn = null;

    // `incluyeEn`/`itinerarioEn` son arrays (no admiten `null`/`undefined` como valor de "sin
    // traducción" vía $set), así que se limpian con $unset en vez de escribirlos en el patch.
    const unsetFields: Record<string, "" > = {};
    if (data.incluye) unsetFields.incluyeEn = "";
    if (data.itinerario) unsetFields.itinerarioEn = "";

    const update: Record<string, unknown> = { $set: patch };
    if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;

    return FullDay.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  },

  async deleteById(id: string) {
    return FullDay.findByIdAndDelete(id);
  },
};
