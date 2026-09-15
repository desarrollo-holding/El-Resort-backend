import mongoose from "mongoose";
import Beneficio, { BeneficioType } from "../models/Beneficio";
import RoomTypeLocalSpecs from "../models/RoomTypeLocalSpecs";
import { GcsStorageService } from "./csStorage.service";
import { TranslateService } from "./translate.service";

export type BeneficioInput = {
  nombreEs: string;
  nombreEn?: string | null;
  orden?: number;
  isActive?: boolean;
};

export type BeneficioIconFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

/** Lo que se expone al frontend; el `iconFileId` es interno de GCS y no sale. */
export type BeneficioDTO = {
  _id: string;
  nombre: { es: string; en: string | null };
  iconUrl: string;
  orden: number;
  isActive: boolean;
};

const toDTO = (doc: BeneficioType | Record<string, any>): BeneficioDTO => ({
  _id: String(doc._id),
  nombre: {
    es: doc.nombre?.es ?? "",
    en: doc.nombre?.en ?? null,
  },
  iconUrl: doc.iconUrl ?? "",
  orden: typeof doc.orden === "number" ? doc.orden : 0,
  isActive: doc.isActive !== false,
});

export class BeneficiosService {
  /**
   * El inglés se resuelve una sola vez al guardar, no en cada lectura: son etiquetas cortas
   * y así el admin puede corregir después la traducción sin que se le vuelva a pisar.
   * Si el traductor falla, se queda en null y el frontend cae al español.
   */
  private static async resolveNombreEn(
    nombreEs: string,
    nombreEn?: string | null
  ): Promise<string | null> {
    const manual = (nombreEn ?? "").trim();
    if (manual) return manual;
    if (!nombreEs.trim()) return null;

    try {
      const [translated] = await TranslateService.translateManySpanishToEnglish([nombreEs]);
      const clean = (translated ?? "").trim();
      // No se descarta una traducción por ser idéntica al original: amenities como «Wifi»,
      // «Yoga» o «Spa» traducen a sí mismas. Descartarlas dejaba `nombre.en` en null para
      // siempre, así que volvían a la cola de pendientes en CADA lectura — el mismo bucle ya
      // documentado en `TranslateService.backfillEnglishField`.
      return clean || null;
    } catch (error) {
      console.error("[BeneficiosService.resolveNombreEn]", error);
      return null;
    }
  }

  /**
   * Auto-cura los `nombre.en` que quedaron en `null` (p. ej. porque el traductor falló cuando se
   * creó/editó el beneficio y nunca se reintentó): traduce los que faltan y persiste el resultado,
   * para no volver a pagar el costo de traducción en cada visita a la ficha de habitación.
   */
  private static async backfillMissingEnglishNames(docs: Array<BeneficioType | Record<string, any>>): Promise<void> {
    const missing = docs.filter((d) => !d.nombre?.en && typeof d.nombre?.es === "string" && d.nombre.es.trim());
    if (missing.length === 0) return;

    const [translations] = await Promise.allSettled([
      TranslateService.translateManySpanishToEnglish(missing.map((d) => d.nombre.es)),
    ]);
    if (translations.status !== "fulfilled") return;

    const ops: any[] = [];
    missing.forEach((doc, i) => {
      // Mismo criterio que arriba: se persiste aunque la traducción coincida con el español.
      // Si el traductor no devolvió nada, se persiste el original para que el beneficio salga
      // de "pendientes" en vez de reintentarse en cada visita a la ficha de habitación.
      const translated = translations.value[i]?.trim() || doc.nombre.es;

      doc.nombre.en = translated;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { "nombre.en": translated } },
        },
      });
    });

    if (ops.length > 0) {
      try {
        await Beneficio.bulkWrite(ops, { ordered: false });
      } catch (error) {
        console.error("[BeneficiosService.backfillMissingEnglishNames] no se pudo persistir:", error);
      }
    }
  }

  static async uploadIcon(file: BeneficioIconFile) {
    const uploaded = await GcsStorageService.uploadFile({
      fileBuffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      mediaKind: "image",
    });
    return { iconUrl: uploaded.url, iconFileId: uploaded.fileId };
  }

  static async list({ includeInactive = false }: { includeInactive?: boolean } = {}) {
    const filter = includeInactive ? {} : { isActive: true };
    const docs = await Beneficio.find(filter).sort({ orden: 1, createdAt: 1 }).lean();
    return docs.map(toDTO);
  }

  static async getById(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await Beneficio.findById(id).lean();
    return doc ? toDTO(doc) : null;
  }

  static async create(input: BeneficioInput, icon: BeneficioIconFile) {
    const { iconUrl, iconFileId } = await this.uploadIcon(icon);

    // Sin `orden` explícito se agrega al final del catálogo.
    const orden =
      typeof input.orden === "number"
        ? input.orden
        : await Beneficio.countDocuments({});

    const created = await Beneficio.create({
      nombre: { es: input.nombreEs, en: await this.resolveNombreEn(input.nombreEs, input.nombreEn) },
      iconUrl,
      iconFileId,
      orden,
      isActive: input.isActive !== false,
    });

    return toDTO(created);
  }

  static async update(id: string, input: Partial<BeneficioInput>, icon?: BeneficioIconFile) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await Beneficio.findById(id);
    if (!doc) return null;

    if (typeof input.nombreEs === "string") doc.nombre.es = input.nombreEs;
    if (input.nombreEn !== undefined) {
      // Vaciar el inglés a propósito re-dispara la traducción automática del español vigente.
      doc.nombre.en = await this.resolveNombreEn(doc.nombre.es, input.nombreEn);
    } else if (typeof input.nombreEs === "string" && !doc.nombre.en) {
      doc.nombre.en = await this.resolveNombreEn(doc.nombre.es, null);
    }
    if (typeof input.orden === "number") doc.orden = input.orden;
    if (typeof input.isActive === "boolean") doc.isActive = input.isActive;

    if (icon) {
      const previousFileId = doc.iconFileId;
      const { iconUrl, iconFileId } = await this.uploadIcon(icon);
      doc.iconUrl = iconUrl;
      doc.iconFileId = iconFileId;
      // El icono viejo se borra después de persistir el nuevo, para no dejar el doc apuntando a nada.
      if (previousFileId) await GcsStorageService.deleteFile({ fileId: previousFileId });
    }

    doc.markModified("nombre");
    await doc.save();
    return toDTO(doc);
  }

  /**
   * Borra el beneficio, su icono en GCS y la referencia en toda propiedad que lo tuviera activo,
   * para no dejar ids colgando en `RoomTypeLocalSpecs.beneficios`.
   */
  static async remove(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) return false;
    const doc = await Beneficio.findById(id);
    if (!doc) return false;

    await RoomTypeLocalSpecs.updateMany(
      { beneficios: doc._id },
      { $pull: { beneficios: doc._id } }
    );

    if (doc.iconFileId) await GcsStorageService.deleteFile({ fileId: doc.iconFileId });
    await doc.deleteOne();
    return true;
  }

  static async reorder(items: Array<{ _id: string; orden: number }>) {
    const ops = items
      .filter((it) => mongoose.Types.ObjectId.isValid(it._id))
      .map((it) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(it._id) },
          update: { $set: { orden: it.orden } },
        },
      }));
    if (ops.length === 0) return 0;
    const result = await Beneficio.bulkWrite(ops);
    return result.modifiedCount ?? 0;
  }

  /**
   * Resuelve los beneficios activos de una propiedad respetando el orden del catálogo.
   * Devuelve `[]` si la propiedad no tiene ninguno: quien llama decide si cae a Cloudbeds.
   */
  static async resolveForRoomType(
    beneficioIds: Array<mongoose.Types.ObjectId | string> | undefined | null
  ): Promise<BeneficioDTO[]> {
    if (!Array.isArray(beneficioIds) || beneficioIds.length === 0) return [];
    const ids = beneficioIds
      .map((id) => String(id))
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (ids.length === 0) return [];

    const docs = await Beneficio.find({ _id: { $in: ids }, isActive: true })
      .sort({ orden: 1, createdAt: 1 })
      .lean();
    await this.backfillMissingEnglishNames(docs);
    return docs.map(toDTO);
  }

  /** Igual que `resolveForRoomType` pero para varias propiedades de una sola consulta. */
  static async resolveForRoomTypes(
    entries: Array<{ roomTypeID: string; beneficios?: Array<mongoose.Types.ObjectId | string> | null }>
  ): Promise<Map<string, BeneficioDTO[]>> {
    const result = new Map<string, BeneficioDTO[]>();

    const allIds = new Set<string>();
    for (const entry of entries) {
      for (const id of entry.beneficios ?? []) {
        const str = String(id);
        if (mongoose.Types.ObjectId.isValid(str)) allIds.add(str);
      }
    }
    if (allIds.size === 0) return result;

    const docs = await Beneficio.find({ _id: { $in: [...allIds] }, isActive: true })
      .sort({ orden: 1, createdAt: 1 })
      .lean();
    await this.backfillMissingEnglishNames(docs);
    const byId = new Map(docs.map((d) => [String(d._id), toDTO(d)]));

    for (const entry of entries) {
      const resolved = (entry.beneficios ?? [])
        .map((id) => byId.get(String(id)))
        .filter((b): b is BeneficioDTO => !!b)
        // El catálogo manda el orden, no el orden en que se marcaron los checkboxes.
        .sort((a, b) => a.orden - b.orden);
      if (resolved.length > 0) result.set(entry.roomTypeID, resolved);
    }

    return result;
  }
}
