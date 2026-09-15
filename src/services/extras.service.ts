import Extra from "../models/Extras";
import { normalizeImageAssetArray, type ImageAssetType } from "../models/shared/imageAsset";
import { TranslateService } from "./translate.service";
import type { Idioma } from "../utils/idioma";

export type ExtrasByGrupoBlock = {
  grupo: string | null;
  extras: ExtraDto[];
};

export type ExtraDto = {
  nombre: string;
  precio: number;
  descripcion: string;
  grupo?: string;
  imagenes: ImageAssetType[];
};

export const ExtrasService = {
  async getExtrasGroupedByGrupo(idioma: Idioma = "es"): Promise<ExtrasByGrupoBlock[]> {
    const extras = await Extra.find({}).sort({ orden: 1 }).lean();

    if (idioma === "en") {
      const [changedNombre, changedDescripcion] = await Promise.all([
        TranslateService.backfillEnglishField(extras, "nombre", "nombreEn"),
        TranslateService.backfillEnglishField(extras, "descripcion", "descripcionEn"),
      ]);
      const ops = [
        ...TranslateService.buildSetOps(changedNombre, "nombreEn"),
        ...TranslateService.buildSetOps(changedDescripcion, "descripcionEn"),
      ];
      // La persistencia es best-effort a propósito: si el bulkWrite falla, la respuesta YA está
      // traducida en memoria y el visitante la recibe igual. Dejarlo sin capturar convertía un
      // fallo de escritura en un 500 permanente para toda la web en inglés.
      if (ops.length > 0) {
        try {
          await Extra.bulkWrite(ops, { ordered: false });
        } catch (error) {
          console.error("[Extra] no se pudo persistir la traduccion al ingles:", error);
        }
      }
    }

    const grouped = new Map<string | null, ExtraDto[]>();

    for (const extra of extras) {
      const grupo = (typeof extra.grupo === "string" && extra.grupo.trim() ? extra.grupo : null) as string | null;

      const normalized: ExtraDto = {
        nombre: (idioma === "en" ? extra.nombreEn : null) || extra.nombre,
        precio: extra.precio,
        descripcion: (idioma === "en" ? extra.descripcionEn : null) || extra.descripcion,
        grupo: grupo ?? undefined,
        imagenes: normalizeImageAssetArray(extra.imagenes),
      };

      const list = grouped.get(grupo);
      if (list) list.push(normalized);
      else grouped.set(grupo, [normalized]);
    }

    const keys = Array.from(grouped.keys()).sort((a, b) => {
      if (a === b) return 0;
      if (a === null) return -1;
      if (b === null) return 1;

      const aNum = Number(a);
      const bNum = Number(b);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum;

      return a.localeCompare(b);
    });

    return keys.map((grupo) => ({ grupo, extras: grouped.get(grupo)! }));
  },
};
