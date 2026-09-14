import Retiro from "../models/Retiros";
import { TranslateService } from "./translate.service";
import type { Idioma } from "../utils/idioma";

type CreateRetiroInput = {
  nombre: string;
  descripcion: string;
  duracionNoches: number;
  fechaInicio: Date;
  fechaFin: Date;
  idealPara: string;
  cuposMaximos: number;
  imagen: string;
  incluye: {
    yoga: boolean;
    comidasPorDia: number;
    masajesIncluidos: boolean;
    trasladoIncluido: boolean;
  };
  actividades: {
    dia: number;
    actividadesDelDia: string[];
  }[];
  precioPorPersona: number;
  disponible: boolean;
  fechaRegistro?: Date;
};

export const RetirosService = {
  async create(data: Partial<CreateRetiroInput>) {
    const created = await Retiro.create(data);
    return created;
  },

  async listAll(idioma: Idioma = "es") {
    const retiros = await Retiro.find({}).sort({ fechaInicio: 1 }).lean();

    if (idioma === "en") {
      const changedNombre = await TranslateService.backfillEnglishField(retiros, "nombre", "nombreEn");
      const changedDescripcion = await TranslateService.backfillEnglishField(retiros, "descripcion", "descripcionEn");
      const changedIdealPara = await TranslateService.backfillEnglishField(retiros, "idealPara", "idealParaEn");

      const allActivityDays = retiros.flatMap((r) => r.actividades ?? []);
      const changedActividades = await TranslateService.backfillEnglishArrayField(
        allActivityDays,
        "actividadesDelDia",
        "actividadesDelDiaEn"
      );

      const ops = [
        ...TranslateService.buildSetOps(changedNombre, "nombreEn"),
        ...TranslateService.buildSetOps(changedDescripcion, "descripcionEn"),
        ...TranslateService.buildSetOps(changedIdealPara, "idealParaEn"),
        ...changedActividades.map((act) => ({
          updateOne: {
            filter: { "actividades._id": act._id },
            update: { $set: { "actividades.$.actividadesDelDiaEn": act.actividadesDelDiaEn } },
          },
        })),
      ];
      if (ops.length > 0) await Retiro.bulkWrite(ops, { ordered: false });
    }

    return idioma === "en"
      ? retiros.map((r) => ({
          ...r,
          nombre: r.nombreEn || r.nombre,
          descripcion: r.descripcionEn || r.descripcion,
          idealPara: r.idealParaEn || r.idealPara,
          actividades: (r.actividades ?? []).map((a) => ({
            ...a,
            actividadesDelDia: a.actividadesDelDiaEn ?? a.actividadesDelDia,
          })),
        }))
      : retiros;
  },

  async getById(id: string) {
    return Retiro.findById(id);
  },

  async updateById(id: string, data: Partial<CreateRetiroInput>) {
    const current = await Retiro.findById(id);
    if (!current) return null;

    // Traducciones cacheadas por el server: nunca se aceptan del cliente, y se invalidan si su
    // fuente en español cambió, para que se regeneren solas en la próxima visita con idioma=en.
    const patch: Record<string, unknown> = { ...data };
    delete patch.nombreEn;
    delete patch.descripcionEn;
    delete patch.idealParaEn;

    if (typeof data.nombre === "string" && data.nombre !== current.nombre) patch.nombreEn = null;
    if (typeof data.descripcion === "string" && data.descripcion !== current.descripcion) patch.descripcionEn = null;
    if (typeof data.idealPara === "string" && data.idealPara !== current.idealPara) patch.idealParaEn = null;
    if (data.actividades) {
      // Se reemplaza el array entero: cualquier `actividadesDelDiaEn` que venga del cliente se
      // ignora (ya se borró arriba junto con el resto de `data`), así el subdocumento nuevo
      // siempre nace sin traducción cacheada y se resuelve sola en la próxima lectura en inglés.
      patch.actividades = data.actividades.map(({ dia, actividadesDelDia }) => ({ dia, actividadesDelDia }));
    }

    return Retiro.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  },

  async deleteById(id: string) {
    return Retiro.findByIdAndDelete(id);
  },
};
