import mongoose from "mongoose";
import RoomTypeLocalSpecs from "../../models/RoomTypeLocalSpecs";
import { BeneficiosService } from "../beneficios.service";
import { RoomsService } from "../rooms.service";
import type { LocalSpecsNormalized, LocalPricingNormalized } from "./types";
import { normalizeImageAsset, normalizeImageAssetArray } from "../../models/shared/imageAsset";

export const normalizeLocalBedrooms = (value: unknown): LocalSpecsNormalized["bedrooms"] => {
  if (!Array.isArray(value)) return [];
  const normalized: LocalSpecsNormalized["bedrooms"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const number = typeof record.number === "number" && Number.isFinite(record.number) ? record.number : undefined;
    if (!number || number < 1) continue;
    const description = typeof record.description === "string" && record.description.trim().length > 0 ? record.description.trim() : undefined;
    const photos = normalizeImageAssetArray(record.photos);
    normalized.push({ number, description, photos });
  }
  normalized.sort((a, b) => a.number - b.number);
  return normalized;
};

export const buildDefaultLocalSpecs = (): LocalSpecsNormalized => ({
  bathroomsCount: 1,
  bedrooms: [{ number: 1, photos: [] }],
});

/**
 * @param roomTypeIDs Si se omite, trae TODAS las propiedades activas (usado como fuente primaria
 * del catálogo público, ya sin depender de que Cloudbeds tenga un roomTypeID equivalente).
 */
export const fetchRoomTypeLocalSpecsIndex = async (roomTypeIDs?: string[]): Promise<Map<string, LocalSpecsNormalized>> => {
  const index = new Map<string, LocalSpecsNormalized>();

  if (mongoose.connection.readyState !== 1) return index;

  const filter: Record<string, unknown> = { isActive: { $ne: false } };
  if (roomTypeIDs !== undefined) {
    const uniqueIDs = Array.from(new Set(roomTypeIDs)).filter((v) => typeof v === "string" && v.trim().length > 0);
    if (uniqueIDs.length === 0) return index;
    filter.roomTypeID = { $in: uniqueIDs };
  }

  const docs = await RoomTypeLocalSpecs.find(filter)
    .select({ roomTypeID: 1, bathroomsCount: 1, titleColor: 1, bedrooms: 1, portada: 1, portadaMenu: 1, posicion_fotos_portadas: 1, orden: 1, beneficios: 1, beneficiosTexto: 1, roomTypeName: 1, roomTypeDescription: 1, maxGuests: 1 })
    .lean();

  // Una sola consulta al catálogo para todas las propiedades del listado.
  const beneficiosByRoomType = await BeneficiosService.resolveForRoomTypes(
    docs.map((doc) => ({
      roomTypeID: String((doc as any).roomTypeID ?? ""),
      beneficios: (doc as any).beneficios,
    }))
  );

  for (const doc of docs) {
    if (!doc || typeof doc.roomTypeID !== "string") continue;
    const bathroomsCount = typeof doc.bathroomsCount === "number" && Number.isFinite(doc.bathroomsCount) ? doc.bathroomsCount : undefined;
    const bedrooms = normalizeLocalBedrooms((doc as unknown as Record<string, unknown>).bedrooms);

    // Backward-compat: si hay docs viejos con bedroomsCount pero sin bedrooms[]
    const legacyBedroomsCount = typeof (doc as unknown as Record<string, unknown>).bedroomsCount === "number" ? (doc as unknown as Record<string, unknown>).bedroomsCount : undefined;
    const derivedBedrooms =
      bedrooms.length > 0
        ? bedrooms
        : typeof legacyBedroomsCount === "number" && Number.isFinite(legacyBedroomsCount) && legacyBedroomsCount > 0
          ? Array.from({ length: Math.floor(legacyBedroomsCount) }, (_, i) => ({ number: i + 1, photos: [] as LocalSpecsNormalized["bedrooms"][number]["photos"] }))
          : [];

    if (bathroomsCount === undefined) continue;
    const portada = normalizeImageAsset((doc as any).portada);
    const portadaMenu = normalizeImageAsset((doc as any).portadaMenu);
    const rawPosicionFotos = (doc as any).posicion_fotos_portadas;
    const posicion_fotos_portadas: Record<string, unknown> | null = rawPosicionFotos && typeof rawPosicionFotos === "object" && !Array.isArray(rawPosicionFotos) ? (rawPosicionFotos as Record<string, unknown>) : null;
    const orden = typeof (doc as any).orden === "number" && Number.isFinite((doc as any).orden) ? (doc as any).orden : undefined;
    const rawName = (doc as any).roomTypeName as { es?: unknown; en?: unknown } | undefined;
    const rawDescription = (doc as any).roomTypeDescription as { es?: unknown; en?: unknown } | undefined;
    index.set(doc.roomTypeID, {
      bathroomsCount,
      titleColor: (doc as any).titleColor ?? null,
      bedrooms: derivedBedrooms,
      portada,
      portadaMenu,
      posicion_fotos_portadas,
      orden,
      beneficios: beneficiosByRoomType.get(doc.roomTypeID) ?? [],
      beneficiosTexto: Array.isArray((doc as any).beneficiosTexto)
        ? ((doc as any).beneficiosTexto as unknown[]).filter((v): v is string => typeof v === "string")
        : [],
      roomTypeNameLocalEs: typeof rawName?.es === "string" ? rawName.es : undefined,
      roomTypeNameLocalEn: typeof rawName?.en === "string" ? rawName.en : null,
      roomTypeDescriptionLocalEs: typeof rawDescription?.es === "string" ? rawDescription.es : undefined,
      roomTypeDescriptionLocalEn: typeof rawDescription?.en === "string" ? rawDescription.en : null,
      maxGuestsLocal: typeof (doc as any).maxGuests === "number" ? (doc as any).maxGuests : null,
    });
  }

  return index;
};

/**
 * Versión mínima de `fetchRoomTypeLocalSpecsIndex` solo para nombre/descripción/maxGuests, usada por
 * `listRoomTypesBase`/`getRoomTypeWithPricing` (los listados que no pasan por `toReducedModel`/
 * `toReducedDetailModel`, los dos puntos de convergencia donde el resto de los endpoints ya resuelve
 * el override local).
 *
 * @param roomTypeIDs Si se omite, trae TODAS las propiedades activas (base del catálogo público).
 */
export const fetchRoomTypeLocalNameDescriptionIndex = async (
  roomTypeIDs?: string[]
): Promise<Map<string, { roomTypeName?: string; roomTypeDescription?: string; maxGuests?: number }>> => {
  const index = new Map<string, { roomTypeName?: string; roomTypeDescription?: string; maxGuests?: number }>();

  if (mongoose.connection.readyState !== 1) return index;

  const filter: Record<string, unknown> = { isActive: { $ne: false } };
  if (roomTypeIDs !== undefined) {
    const uniqueIDs = Array.from(new Set(roomTypeIDs)).filter((v) => typeof v === "string" && v.trim().length > 0);
    if (uniqueIDs.length === 0) return index;
    filter.roomTypeID = { $in: uniqueIDs };
  }

  const docs = await RoomTypeLocalSpecs.find(filter)
    .select({ roomTypeID: 1, roomTypeName: 1, roomTypeDescription: 1, maxGuests: 1 })
    .lean();

  for (const doc of docs) {
    if (!doc || typeof doc.roomTypeID !== "string") continue;
    const rawName = (doc as any).roomTypeName as { es?: unknown } | undefined;
    const rawDescription = (doc as any).roomTypeDescription as { es?: unknown } | undefined;
    index.set(doc.roomTypeID, {
      roomTypeName: typeof rawName?.es === "string" ? rawName.es : undefined,
      roomTypeDescription: typeof rawDescription?.es === "string" ? rawDescription.es : undefined,
      maxGuests: typeof (doc as any).maxGuests === "number" ? (doc as any).maxGuests : undefined,
    });
  }

  return index;
};

export const fetchRoomTypeLocalPricingIndex = async (roomTypeIDs: string[]): Promise<Map<string, LocalPricingNormalized>> => {
  const index = new Map<string, LocalPricingNormalized>();

  if (mongoose.connection.readyState !== 1) return index;

  const uniqueIDs = Array.from(new Set(roomTypeIDs)).filter((v) => typeof v === "string" && v.trim().length > 0);
  if (uniqueIDs.length === 0) return index;

  const docs = await RoomTypeLocalSpecs.find({ roomTypeID: { $in: uniqueIDs }, isActive: { $ne: false } })
    .select({ roomTypeID: 1, pricing: 1 })
    .lean();

  for (const doc of docs) {
    if (!doc || typeof doc.roomTypeID !== "string") continue;

    const pricing = (doc as unknown as Record<string, unknown>).pricing;
    const pricingRecord = pricing && typeof pricing === "object" && !Array.isArray(pricing) ? (pricing as Record<string, unknown>) : undefined;
    if (!pricingRecord) continue;

    const totalRate = typeof pricingRecord.totalRate === "number" && Number.isFinite(pricingRecord.totalRate) ? pricingRecord.totalRate : undefined;
    const ofertaDelMesRoomRate =
      typeof pricingRecord.ofertaDelMesRoomRate === "number" && Number.isFinite(pricingRecord.ofertaDelMesRoomRate)
        ? pricingRecord.ofertaDelMesRoomRate
        : undefined;

    if (totalRate === undefined && ofertaDelMesRoomRate === undefined) continue;

    index.set(doc.roomTypeID, { totalRate, ofertaDelMesRoomRate });
  }

  return index;
};

export const enrichPricingIndexWithCloudBeds = async (
  roomTypeIDs: string[],
  pricingIndex: Map<string, LocalPricingNormalized>
): Promise<Map<string, LocalPricingNormalized>> => {
  const needsEnrichment = roomTypeIDs.filter((id) => {
    const p = pricingIndex.get(id);
    if (!p) return true;
    // Necesita enriquecimiento si totalRate es 0 o undefined
    return !p.totalRate || p.totalRate === 0;
  });
  if (needsEnrichment.length === 0) return pricingIndex;

  try {
    const cbRates = await RoomsService.getCloudBedsRatesMap();
    for (const id of needsEnrichment) {
      const cb = cbRates.get(id);
      if (!cb) continue;
      const existing = pricingIndex.get(id) ?? {};
      if ((existing.totalRate === undefined || existing.totalRate === 0) && cb.totalRate !== undefined) {
        existing.totalRate = cb.totalRate;
      }
      if ((existing.ofertaDelMesRoomRate === undefined || existing.ofertaDelMesRoomRate === 0) && cb.ofertaRate !== undefined) {
        existing.ofertaDelMesRoomRate = cb.ofertaRate;
      }
      if (existing.totalRate !== undefined || existing.ofertaDelMesRoomRate !== undefined) {
        pricingIndex.set(id, existing);
      }
    }
  } catch {
    // CloudBeds no disponible, continuar con pricing local
  }

  return pricingIndex;
};
