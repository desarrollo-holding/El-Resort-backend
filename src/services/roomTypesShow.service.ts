import { RoomsService, type JsonObject } from "./rooms.service";

import { type RoomTypeModel } from "../models/RoomType.model";
import type { RoomTypeReducedDetailModel, RoomTypeReducedModel } from "../models/RoomTypeReduced.model";
import RoomTypeLocalSpecs from "../models/RoomTypeLocalSpecs";
import mongoose from "mongoose";
import { RatesService } from "./rates.service";
import type { RateSummary } from "../models/RateSummary";

const EXTENDED_STAY_MIN_NIGHTS = 4;

type CloudbedsRoomsResponse = {
  success?: boolean;
  data?: Array<{
    propertyID?: string;
    rooms?: Array<{
      roomID?: string;
      roomName?: string;
      roomTypeID?: string;
    }>;
  }>;
  count?: number;
  total?: number;
};

type CloudbedsRoomTypesResponse = {
  success?: boolean;
  data?: Array<Record<string, unknown>>;
  count?: number;
  total?: number;
};

type CloudbedsRatePlansResponse = {
  success?: boolean;
  data?: Array<Record<string, unknown>>;
};

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const asNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const normalizeRoomTypeFeatures = (value: unknown): string[] | undefined => {
  const arr = asStringArray(value);
  if (arr) return arr;

  const record = asRecord(value);
  if (!record) return undefined;

  return Object.keys(record)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => record[k])
    .filter((v): v is string => typeof v === "string");
};

const parseCloudbedsRoomsResponse = (raw: JsonObject): CloudbedsRoomsResponse => raw as unknown as CloudbedsRoomsResponse;
const parseCloudbedsRoomTypesResponse = (raw: JsonObject): CloudbedsRoomTypesResponse => raw as unknown as CloudbedsRoomTypesResponse;
const parseCloudbedsRatePlansResponse = (raw: JsonObject): CloudbedsRatePlansResponse => raw as unknown as CloudbedsRatePlansResponse;

const parseYmdToUtcMs = (value: string): number | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return ms;
};

const getNightsBetween = (startDate: string, endDate: string): number => {
  const startMs = parseYmdToUtcMs(startDate);
  const endMs = parseYmdToUtcMs(endDate);
  if (startMs === undefined || endMs === undefined) return 0;
  const diff = (endMs - startMs) / (24 * 60 * 60 * 1000);
  return Number.isInteger(diff) && diff > 0 ? diff : 0;
};

const normalizeForSearch = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const isExtendedStayRatePlan = (ratePlan: RateSummary): boolean => {
  const names = [ratePlan.ratePlanNamePublic, ratePlan.ratePlanNamePrivate].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0
  );
  const haystack = normalizeForSearch(names.join(" "));
  if (haystack.includes("estadia extendida")) return true;
  if (haystack.includes("extended stay")) return true;
  if (haystack.includes("long stay")) return true;

  const derivedType = typeof ratePlan.derivedType === "string" ? normalizeForSearch(ratePlan.derivedType) : "";
  if (derivedType.includes("extended")) return true;

  return false;
};

const buildInventoryIndex = (
  rooms: Array<{ roomTypeID: string; roomID: string; roomName: string }>
): Map<string, { roomIDs: string[]; roomNames: string[] }> => {
  const index = new Map<string, { roomIDs: string[]; roomNames: string[] }>();
  for (const room of rooms) {
    const existing = index.get(room.roomTypeID) ?? { roomIDs: [], roomNames: [] };
    existing.roomIDs.push(room.roomID);
    existing.roomNames.push(room.roomName);
    index.set(room.roomTypeID, existing);
  }
  return index;
};

const fetchAllRoomsForDates = async (params: {
  startDate: string;
  endDate: string;
  roomTypeID?: string;
}): Promise<Array<{ roomTypeID: string; roomID: string; roomName: string }>> => {
  const pageSize = 50;
  const maxPages = 200;

  const allRooms: Array<{ roomTypeID: string; roomID: string; roomName: string }> = [];
  let pageNumber = 1;
  let lastTotal: number | undefined;

  while (pageNumber <= maxPages) {
    const raw = await RoomsService.getRooms({
      startDate: params.startDate,
      endDate: params.endDate,
      roomTypeID: params.roomTypeID,
      includeRoomRelations: 0,
      pageNumber,
      pageSize,
    });

    const parsed = parseCloudbedsRoomsResponse(raw);
    const properties = Array.isArray(parsed.data) ? parsed.data : [];
    const pageRooms = properties.flatMap((p) => (Array.isArray(p.rooms) ? p.rooms : []));

    for (const r of pageRooms) {
      const roomTypeID = asString(r.roomTypeID);
      const roomID = asString(r.roomID);
      const roomName = asString(r.roomName);
      if (!roomTypeID || !roomID || !roomName) continue;
      allRooms.push({ roomTypeID, roomID, roomName });
    }

    const total = asNumber(parsed.total);
    if (total !== undefined && total > 0) lastTotal = total;
    if (lastTotal !== undefined && allRooms.length >= lastTotal) break;

    if (pageRooms.length === 0) break;
    pageNumber += 1;
  }

  return allRooms;
};

const fetchRoomTypesDetails = async (params: {
  roomTypeIDs?: string[];
  maxGuests?: number;
}): Promise<Array<Record<string, unknown>>> => {
  const uniqueRoomTypeIDs = Array.isArray(params.roomTypeIDs)
    ? Array.from(new Set(params.roomTypeIDs.filter((id): id is string => typeof id === "string" && id.trim().length > 0)))
    : undefined;

  if (Array.isArray(uniqueRoomTypeIDs) && uniqueRoomTypeIDs.length === 0) return [];

  const pageSize = 50;
  const maxPages = 200;

  const all: Array<Record<string, unknown>> = [];
  let pageNumber = 1;
  let lastTotal: number | undefined;

  while (pageNumber <= maxPages) {
    const raw = await RoomsService.getRoomTypes({
      roomTypeIDs: uniqueRoomTypeIDs ? uniqueRoomTypeIDs.join(",") : undefined,
      maxGuests: params.maxGuests !== undefined ? String(params.maxGuests) : undefined,
      pageNumber,
      pageSize,
    });

    const parsed = parseCloudbedsRoomTypesResponse(raw);
    const data = Array.isArray(parsed.data) ? parsed.data : [];
    for (const item of data) all.push(item);

    const total = asNumber(parsed.total);
    if (total !== undefined && total > 0) lastTotal = total;
    if (lastTotal !== undefined && all.length >= lastTotal) break;

    if (data.length === 0) break;
    pageNumber += 1;
  }

  return all;
};

const fetchRatePlansIndex = async (params: {
  roomTypeIDs: string[];
  startDate: string;
  endDate: string;
  promoCode?: string;
}): Promise<Map<string, { baseRate?: NonNullable<RoomTypeModel["pricing"]["baseRate"]>; ratePlans: RateSummary[] }>> => {
  const index = new Map<string, { baseRate?: NonNullable<RoomTypeModel["pricing"]["baseRate"]>; ratePlans: RateSummary[] }>();
  if (!params.roomTypeIDs.length) return index;

  const raw = await RatesService.getRatePlans({
    roomTypeID: params.roomTypeIDs.join(","),
    startDate: params.startDate,
    endDate: params.endDate,
    promoCode: params.promoCode,
    includePromoCode: params.promoCode ? undefined : false,
  });

  const parsed = parseCloudbedsRatePlansResponse(raw);
  const data = Array.isArray(parsed.data) ? parsed.data : [];

  for (const item of data) {
    const roomTypeID = asString(item.roomTypeID);
    const rateID = asString(item.rateID);
    const roomRate = asNumber(item.roomRate);
    const totalRate = asNumber(item.totalRate);
    const roomsAvailable = asNumber(item.roomsAvailable);
    const isDerived = typeof item.isDerived === "boolean" ? item.isDerived : undefined;

    if (!roomTypeID || !rateID || roomRate === undefined || totalRate === undefined || roomsAvailable === undefined || isDerived === undefined) continue;

    const bucket = index.get(roomTypeID) ?? { ratePlans: [] as RateSummary[] };

    if (isDerived === false) {
      if (!bucket.baseRate) {
        bucket.baseRate = { rateID, roomRate, totalRate, roomsAvailable, isDerived };
      }
    } else {
      bucket.ratePlans.push({
        rateID,
        roomRate,
        totalRate,
        roomsAvailable,
        isDerived,
        ratePlanID: asString(item.ratePlanID),
        ratePlanNamePublic: asString(item.ratePlanNamePublic),
        ratePlanNamePrivate: asString(item.ratePlanNamePrivate),
        promoCode: asString(item.promoCode),
        derivedType: asString(item.derivedType),
        derivedValue: asNumber(item.derivedValue),
        baseRate: asNumber(item.baseRate),
        ratePlanAddOns: Array.isArray(item.ratePlanAddOns) ? (item.ratePlanAddOns as unknown[]) : undefined,
      });
    }

    index.set(roomTypeID, bucket);
  }

  return index;
};

type LocalSpecsNormalized = {
  bathroomsCount: number;
  titleColor?: string | null;
  bedrooms: Array<{ number: number; description?: string; photos: string[] }>;
  portada?: string | null;
  portadaMenu?: string | null;
  posicion_fotos_portadas?: Record<string, unknown> | null;
  orden?: number;
};
type LocalPricingNormalized = { totalRate?: number; ofertaDelMesRoomRate?: number };
type ReducedMappingOptions = { applyFallbackDefaults?: boolean; portadaOnly?: boolean; includePortadaMenu?: boolean };

const normalizeLocalBedrooms = (value: unknown): LocalSpecsNormalized["bedrooms"] => {
  if (!Array.isArray(value)) return [];
  const normalized: LocalSpecsNormalized["bedrooms"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const number = typeof record.number === "number" && Number.isFinite(record.number) ? record.number : undefined;
    if (!number || number < 1) continue;
    const description = typeof record.description === "string" && record.description.trim().length > 0 ? record.description.trim() : undefined;
    const photos = Array.isArray(record.photos) ? record.photos.filter((p): p is string => typeof p === "string") : [];
    normalized.push({ number, description, photos });
  }
  normalized.sort((a, b) => a.number - b.number);
  return normalized;
};

const buildDefaultLocalSpecs = (): LocalSpecsNormalized => ({
  bathroomsCount: 1,
  bedrooms: [{ number: 1, photos: [] }],
});

const fetchRoomTypeLocalSpecsIndex = async (roomTypeIDs: string[]): Promise<Map<string, LocalSpecsNormalized>> => {
  const index = new Map<string, LocalSpecsNormalized>();

  if (mongoose.connection.readyState !== 1) return index;

  const uniqueIDs = Array.from(new Set(roomTypeIDs)).filter((v) => typeof v === "string" && v.trim().length > 0);
  if (uniqueIDs.length === 0) return index;

  const docs = await RoomTypeLocalSpecs.find({ roomTypeID: { $in: uniqueIDs }, isActive: { $ne: false } })
    .select({ roomTypeID: 1, bathroomsCount: 1, titleColor: 1, bedrooms: 1, portada: 1, portadaMenu: 1, posicion_fotos_portadas: 1, orden: 1 })
    .lean();

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
          ? Array.from({ length: Math.floor(legacyBedroomsCount) }, (_, i) => ({ number: i + 1, photos: [] as string[] }))
          : [];

    if (bathroomsCount === undefined) continue;
    const rawPortada = (doc as any).portada;
    const portada: string | null = typeof rawPortada === "string" ? rawPortada : null;
    const rawPortadaMenu = (doc as any).portadaMenu;
    const portadaMenu: string | null = typeof rawPortadaMenu === "string" ? rawPortadaMenu : null;
    const rawPosicionFotos = (doc as any).posicion_fotos_portadas;
    const posicion_fotos_portadas: Record<string, unknown> | null = rawPosicionFotos && typeof rawPosicionFotos === "object" && !Array.isArray(rawPosicionFotos) ? (rawPosicionFotos as Record<string, unknown>) : null;
    const orden = typeof (doc as any).orden === "number" && Number.isFinite((doc as any).orden) ? (doc as any).orden : undefined;
    index.set(doc.roomTypeID, { bathroomsCount, titleColor: (doc as any).titleColor ?? null, bedrooms: derivedBedrooms, portada, portadaMenu, posicion_fotos_portadas, orden });
  }

  return index;
};

const fetchRoomTypeLocalPricingIndex = async (roomTypeIDs: string[]): Promise<Map<string, LocalPricingNormalized>> => {
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

export const RoomTypesShowService = {
  async listRoomTypesBase(params: { startDate: string; endDate: string; maxGuests?: number }): Promise<RoomTypeModel[]> {
    const rooms = await fetchAllRoomsForDates({ startDate: params.startDate, endDate: params.endDate });
    const inventoryByRoomType = buildInventoryIndex(rooms);
    const roomTypeIDs = Array.from(new Set(rooms.map((r) => r.roomTypeID)));

    const roomTypes = await fetchRoomTypesDetails({ roomTypeIDs, maxGuests: params.maxGuests });

    const models: RoomTypeModel[] = [];
    for (const rt of roomTypes) {
      const roomTypeID = asString(rt.roomTypeID);
      const roomTypeName = asString(rt.roomTypeName);
      if (!roomTypeID || !roomTypeName) continue;

      const inventory = inventoryByRoomType.get(roomTypeID) ?? { roomIDs: [], roomNames: [] };
      if (inventory.roomIDs.length === 0) continue;

      const photos = asStringArray(rt.roomTypePhotos) ?? [];

      models.push({
        roomTypeID,
        presentation: {
          roomTypeName,
          roomTypeNameShort: asString(rt.roomTypeNameShort),
          roomTypeDescription: asString(rt.roomTypeDescription),
          roomTypePhotos: photos,
          maxGuests: asNumber(rt.maxGuests),
          adultsIncluded: asNumber(rt.adultsIncluded),
          childrenIncluded: asNumber(rt.childrenIncluded),
          roomTypeFeatures: normalizeRoomTypeFeatures(rt.roomTypeFeatures),
        },
        inventory: {
          roomIDs: inventory.roomIDs,
          roomNames: inventory.roomNames,
          totalUnits: asNumber(rt.roomTypeUnits),
          linkedRoomIDs: asStringArray(rt.linkedRoomIDs),
          linkedRoomTypeIDs: asStringArray(rt.linkedRoomTypeIDs),
          linkedRoomTypeQty: Array.isArray(rt.linkedRoomTypeQty)
            ? rt.linkedRoomTypeQty
                .map((v) => asRecord(v))
                .filter((v): v is Record<string, unknown> => !!v)
                .map((v) => ({
                  roomTypeID: asString(v.roomTypeID) ?? "",
                  roomQty: asNumber(v.roomQty) ?? 0,
                }))
                .filter((v) => v.roomTypeID.length > 0 && v.roomQty > 0)
            : undefined,
        },
        pricing: {
          ratePlans: [],
        },
      });
    }

    return models;
  },

  async listRoomTypesWithPricing(params: {
    startDate: string;
    endDate: string;
    maxGuests?: number;
    promoCode?: string;
    }): Promise<RoomTypeModel[]> {
      const baseModels = await this.listRoomTypesBase({ startDate: params.startDate, endDate: params.endDate, maxGuests: params.maxGuests });
      const roomTypeIDs = baseModels.map((m) => m.roomTypeID);
      const nights = getNightsBetween(params.startDate, params.endDate);

      const pricingIndex = await fetchRatePlansIndex({
        roomTypeIDs,
        startDate: params.startDate,
        endDate: params.endDate,
      promoCode: params.promoCode,
    });

      return baseModels.map((m) => {
        const pricing = pricingIndex.get(m.roomTypeID);
        const rawRatePlans = pricing?.ratePlans ?? [];
        const ratePlans =
          nights >= EXTENDED_STAY_MIN_NIGHTS ? rawRatePlans : rawRatePlans.filter((rp) => !isExtendedStayRatePlan(rp));
        return {
          ...m,
          pricing: {
            baseRate: pricing?.baseRate,
            ratePlans,
          },
        };
      });
    },

  async getRoomTypeWithPricing(params: {
    roomTypeID: string;
    startDate: string;
    endDate: string;
    maxGuests?: number;
    promoCode?: string;
  }): Promise<RoomTypeModel | null> {
    const rooms = await fetchAllRoomsForDates({
      startDate: params.startDate,
      endDate: params.endDate,
      roomTypeID: params.roomTypeID,
    });

    const inventoryByRoomType = buildInventoryIndex(rooms);
    const inventory = inventoryByRoomType.get(params.roomTypeID) ?? { roomIDs: [], roomNames: [] };
    if (inventory.roomIDs.length === 0) return null;

    const details = await fetchRoomTypesDetails({ roomTypeIDs: [params.roomTypeID], maxGuests: params.maxGuests });
    const rt = details[0];
    if (!rt) return null;

    const roomTypeID = asString(rt.roomTypeID);
    const roomTypeName = asString(rt.roomTypeName);
    if (!roomTypeID || !roomTypeName) return null;

    const model: RoomTypeModel = {
      roomTypeID,
      presentation: {
        roomTypeName,
        roomTypeNameShort: asString(rt.roomTypeNameShort),
        roomTypeDescription: asString(rt.roomTypeDescription),
        roomTypePhotos: asStringArray(rt.roomTypePhotos) ?? [],
        maxGuests: asNumber(rt.maxGuests),
        adultsIncluded: asNumber(rt.adultsIncluded),
        childrenIncluded: asNumber(rt.childrenIncluded),
        roomTypeFeatures: normalizeRoomTypeFeatures(rt.roomTypeFeatures),
      },
      inventory: {
        roomIDs: inventory.roomIDs,
        roomNames: inventory.roomNames,
        totalUnits: asNumber(rt.roomTypeUnits),
        linkedRoomIDs: asStringArray(rt.linkedRoomIDs),
        linkedRoomTypeIDs: asStringArray(rt.linkedRoomTypeIDs),
        linkedRoomTypeQty: Array.isArray(rt.linkedRoomTypeQty)
          ? rt.linkedRoomTypeQty
              .map((v) => asRecord(v))
              .filter((v): v is Record<string, unknown> => !!v)
              .map((v) => ({
                roomTypeID: asString(v.roomTypeID) ?? "",
                roomQty: asNumber(v.roomQty) ?? 0,
              }))
              .filter((v) => v.roomTypeID.length > 0 && v.roomQty > 0)
          : undefined,
      },
      pricing: {
        ratePlans: [],
      },
    };

    const pricingIndex = await fetchRatePlansIndex({
      roomTypeIDs: [roomTypeID],
      startDate: params.startDate,
      endDate: params.endDate,
      promoCode: params.promoCode,
    });

    const pricing = pricingIndex.get(roomTypeID);
    const nights = getNightsBetween(params.startDate, params.endDate);
    const rawRatePlans = pricing?.ratePlans ?? [];
    const ratePlans = nights >= EXTENDED_STAY_MIN_NIGHTS ? rawRatePlans : rawRatePlans.filter((rp) => !isExtendedStayRatePlan(rp));

    return {
      ...model,
      pricing: {
        baseRate: pricing?.baseRate,
        ratePlans,
      },
    };
  },

  toReducedModel(
    model: RoomTypeModel,
    localSpecs?: LocalSpecsNormalized,
    options?: ReducedMappingOptions,
    localPricing?: LocalPricingNormalized
  ): RoomTypeReducedModel {
    const ofertaDelMes = model.pricing.ratePlans.find((rp) => (rp.ratePlanNamePublic ?? "").trim() === "Oferta del Mes");
    const applyFallbackDefaults = options?.applyFallbackDefaults !== false;
    const resolvedSpecs = applyFallbackDefaults
      ? localSpecs && localSpecs.bedrooms.length > 0
        ? localSpecs
        : localSpecs
          ? { ...localSpecs, bedrooms: buildDefaultLocalSpecs().bedrooms }
          : buildDefaultLocalSpecs()
      : localSpecs ?? { bathroomsCount: 0, bedrooms: [] };
    const includeSpecs = applyFallbackDefaults || !!localSpecs;

    const result: Partial<Record<string, unknown>> = {
      roomTypeID: model.roomTypeID,
      roomTypeName: model.presentation.roomTypeName,
      maxGuests: model.presentation.maxGuests,
      pricing: {
        totalRate: localPricing?.totalRate ?? model.pricing.baseRate?.totalRate,
        ofertaDelMesRoomRate: localPricing?.ofertaDelMesRoomRate ?? ofertaDelMes?.roomRate,
      },
    };

    if (includeSpecs) {
      (result as any).bedroomsCount = resolvedSpecs.bedrooms.length;
      (result as any).bathroomsCount = resolvedSpecs.bathroomsCount ?? 0;
      (result as any).titleColor = resolvedSpecs.titleColor ?? null;
    }

    // Always include `portada` (may be null) so clients receive the field consistently
    (result as any).portada = localSpecs && localSpecs.portada ? localSpecs.portada : null;

    // Include posicion_fotos_portadas (may be null)
    (result as any).posicion_fotos_portadas = localSpecs && (localSpecs as any).posicion_fotos_portadas ? (localSpecs as any).posicion_fotos_portadas : null;

    // Include `portadaMenu` only when explicitly requested (detail responses)
    if (options?.includePortadaMenu) {
      (result as any).portadaMenu = localSpecs && localSpecs.portadaMenu ? localSpecs.portadaMenu : null;
    }

    if (!options?.portadaOnly) {
      (result as any).roomTypePhotos = model.presentation.roomTypePhotos;
    }

    return result as RoomTypeReducedModel;
  },

  toReducedDetailModel(
    model: RoomTypeModel,
    localSpecs?: LocalSpecsNormalized,
    options?: ReducedMappingOptions,
    localPricing?: LocalPricingNormalized
  ): RoomTypeReducedDetailModel {
    const applyFallbackDefaults = options?.applyFallbackDefaults !== false;
    const resolvedSpecs = applyFallbackDefaults
      ? localSpecs && localSpecs.bedrooms.length > 0
        ? localSpecs
        : localSpecs
          ? { ...localSpecs, bedrooms: buildDefaultLocalSpecs().bedrooms }
          : buildDefaultLocalSpecs()
      : localSpecs ?? { bathroomsCount: 0, bedrooms: [] };
    const includeSpecs = applyFallbackDefaults || !!localSpecs;
    const base = this.toReducedModel(model, localSpecs, { applyFallbackDefaults, includePortadaMenu: options?.includePortadaMenu }, localPricing);

    // For the detailed view we must NOT expose `portada` anymore; instead always expose `portadaMenu` (may be null)
    const result: any = { ...base };
    delete result.portada;
    result.portadaMenu = localSpecs && localSpecs.portadaMenu ? localSpecs.portadaMenu : null;
    result.posicion_fotos_portadas = localSpecs && (localSpecs as any).posicion_fotos_portadas ? (localSpecs as any).posicion_fotos_portadas : null;

    return {
      ...result,
      roomTypeDescription: model.presentation.roomTypeDescription,
      roomTypeFeatures: model.presentation.roomTypeFeatures,
      ...(includeSpecs ? { bedrooms: resolvedSpecs.bedrooms } : {}),
    } as RoomTypeReducedDetailModel;
  },

  async listRoomTypesReducedWithPricing(params: {
    startDate: string;
    endDate: string;
    maxGuests?: number;
    promoCode?: string;
  }): Promise<RoomTypeReducedModel[]> {
    const full = await this.listRoomTypesWithPricing(params);
    const specsIndex = await fetchRoomTypeLocalSpecsIndex(full.map((m) => m.roomTypeID));
    // Ordenar por `orden` ascendente; los que no tengan `orden` quedan al final
    full.sort((a, b) => {
      const oa = specsIndex.get(a.roomTypeID)?.orden;
      const ob = specsIndex.get(b.roomTypeID)?.orden;
      const va = Number.isFinite(oa as number) ? (oa as number) : Infinity;
      const vb = Number.isFinite(ob as number) ? (ob as number) : Infinity;
      if (va !== vb) return va - vb;
      return a.roomTypeID.localeCompare(b.roomTypeID);
    });

    return full.map((m) => this.toReducedModel(m, specsIndex.get(m.roomTypeID)));
  },

  async listRoomTypesReducedCatalogWithPricing(params: {
    startDate: string;
    endDate: string;
    maxGuests?: number;
    promoCode?: string;
  }): Promise<RoomTypeReducedModel[]> {
    const roomTypes = await fetchRoomTypesDetails({ maxGuests: params.maxGuests });

    const full: RoomTypeModel[] = [];
    for (const rt of roomTypes) {
      const roomTypeID = asString(rt.roomTypeID);
      const roomTypeName = asString(rt.roomTypeName);
      if (!roomTypeID || !roomTypeName) continue;

      full.push({
        roomTypeID,
        presentation: {
          roomTypeName,
          roomTypeNameShort: asString(rt.roomTypeNameShort),
          roomTypeDescription: asString(rt.roomTypeDescription),
          roomTypePhotos: asStringArray(rt.roomTypePhotos) ?? [],
          maxGuests: asNumber(rt.maxGuests),
          adultsIncluded: asNumber(rt.adultsIncluded),
          childrenIncluded: asNumber(rt.childrenIncluded),
          roomTypeFeatures: normalizeRoomTypeFeatures(rt.roomTypeFeatures),
        },
        inventory: {
          roomIDs: [],
          roomNames: [],
          totalUnits: asNumber(rt.roomTypeUnits),
          linkedRoomIDs: asStringArray(rt.linkedRoomIDs),
          linkedRoomTypeIDs: asStringArray(rt.linkedRoomTypeIDs),
          linkedRoomTypeQty: Array.isArray(rt.linkedRoomTypeQty)
            ? rt.linkedRoomTypeQty
                .map((v) => asRecord(v))
                .filter((v): v is Record<string, unknown> => !!v)
                .map((v) => ({
                  roomTypeID: asString(v.roomTypeID) ?? "",
                  roomQty: asNumber(v.roomQty) ?? 0,
                }))
                .filter((v) => v.roomTypeID.length > 0 && v.roomQty > 0)
            : undefined,
        },
        pricing: {
          ratePlans: [],
        },
      });
    }

    const pricingIndex = await fetchRatePlansIndex({
      roomTypeIDs: full.map((m) => m.roomTypeID),
      startDate: params.startDate,
      endDate: params.endDate,
      promoCode: params.promoCode,
    });

    const nights = getNightsBetween(params.startDate, params.endDate);
    const specsIndex = await fetchRoomTypeLocalSpecsIndex(full.map((m) => m.roomTypeID));

    // Ordenar por `orden` ascendente; los que no tengan `orden` quedan al final
    full.sort((a, b) => {
      const oa = specsIndex.get(a.roomTypeID)?.orden;
      const ob = specsIndex.get(b.roomTypeID)?.orden;
      const va = Number.isFinite(oa as number) ? (oa as number) : Infinity;
      const vb = Number.isFinite(ob as number) ? (ob as number) : Infinity;
      if (va !== vb) return va - vb;
      return a.roomTypeID.localeCompare(b.roomTypeID);
    });

    return full.map((m) => {
      const pricing = pricingIndex.get(m.roomTypeID);
      const rawRatePlans = pricing?.ratePlans ?? [];
      const ratePlans =
        nights >= EXTENDED_STAY_MIN_NIGHTS ? rawRatePlans : rawRatePlans.filter((rp) => !isExtendedStayRatePlan(rp));

      const withPricing: RoomTypeModel = {
        ...m,
        pricing: {
          baseRate: pricing?.baseRate,
          ratePlans,
        },
      };

      return this.toReducedModel(withPricing, specsIndex.get(m.roomTypeID));
    });
  },

  async listRoomTypesReducedCatalogWithLocalPricing(params: {
    maxGuests?: number;
  }): Promise<RoomTypeReducedModel[]> {
    const roomTypes = await fetchRoomTypesDetails({ maxGuests: params.maxGuests });

    const full: RoomTypeModel[] = [];
    for (const rt of roomTypes) {
      const roomTypeID = asString(rt.roomTypeID);
      const roomTypeName = asString(rt.roomTypeName);
      if (!roomTypeID || !roomTypeName) continue;

      full.push({
        roomTypeID,
        presentation: {
          roomTypeName,
          roomTypeNameShort: asString(rt.roomTypeNameShort),
          roomTypeDescription: asString(rt.roomTypeDescription),
          roomTypePhotos: asStringArray(rt.roomTypePhotos) ?? [],
          maxGuests: asNumber(rt.maxGuests),
          adultsIncluded: asNumber(rt.adultsIncluded),
          childrenIncluded: asNumber(rt.childrenIncluded),
          roomTypeFeatures: normalizeRoomTypeFeatures(rt.roomTypeFeatures),
        },
        inventory: {
          roomIDs: [],
          roomNames: [],
          totalUnits: asNumber(rt.roomTypeUnits),
          linkedRoomIDs: asStringArray(rt.linkedRoomIDs),
          linkedRoomTypeIDs: asStringArray(rt.linkedRoomTypeIDs),
          linkedRoomTypeQty: Array.isArray(rt.linkedRoomTypeQty)
            ? rt.linkedRoomTypeQty
                .map((v) => asRecord(v))
                .filter((v): v is Record<string, unknown> => !!v)
                .map((v) => ({
                  roomTypeID: asString(v.roomTypeID) ?? "",
                  roomQty: asNumber(v.roomQty) ?? 0,
                }))
                .filter((v) => v.roomTypeID.length > 0 && v.roomQty > 0)
            : undefined,
        },
        pricing: {
          ratePlans: [],
        },
      });
    }

    const specsIndex = await fetchRoomTypeLocalSpecsIndex(full.map((m) => m.roomTypeID));
    const pricingIndex = await fetchRoomTypeLocalPricingIndex(full.map((m) => m.roomTypeID));

    // Ordenar por `orden` ascendente; los que no tengan `orden` quedan al final
    full.sort((a, b) => {
      const oa = specsIndex.get(a.roomTypeID)?.orden;
      const ob = specsIndex.get(b.roomTypeID)?.orden;
      const va = Number.isFinite(oa as number) ? (oa as number) : Infinity;
      const vb = Number.isFinite(ob as number) ? (ob as number) : Infinity;
      if (va !== vb) return va - vb;
      return a.roomTypeID.localeCompare(b.roomTypeID);
    });

    return full.map((m) => this.toReducedModel(m, specsIndex.get(m.roomTypeID), { portadaOnly: true }, pricingIndex.get(m.roomTypeID)));
  },

  async getRoomTypeReducedDetailWithLocalPricing(params: {
    roomTypeID: string;
    maxGuests?: number;
  }): Promise<RoomTypeReducedDetailModel | null> {
    const details = await fetchRoomTypesDetails({ roomTypeIDs: [params.roomTypeID], maxGuests: params.maxGuests });
    const rt = details[0];
    if (!rt) return null;

    const roomTypeID = asString(rt.roomTypeID);
    const roomTypeName = asString(rt.roomTypeName);
    if (!roomTypeID || !roomTypeName) return null;

    const model: RoomTypeModel = {
      roomTypeID,
      presentation: {
        roomTypeName,
        roomTypeNameShort: asString(rt.roomTypeNameShort),
        roomTypeDescription: asString(rt.roomTypeDescription),
        roomTypePhotos: asStringArray(rt.roomTypePhotos) ?? [],
        maxGuests: asNumber(rt.maxGuests),
        adultsIncluded: asNumber(rt.adultsIncluded),
        childrenIncluded: asNumber(rt.childrenIncluded),
        roomTypeFeatures: normalizeRoomTypeFeatures(rt.roomTypeFeatures),
      },
      inventory: {
        roomIDs: [],
        roomNames: [],
        totalUnits: asNumber(rt.roomTypeUnits),
        linkedRoomIDs: asStringArray(rt.linkedRoomIDs),
        linkedRoomTypeIDs: asStringArray(rt.linkedRoomTypeIDs),
        linkedRoomTypeQty: Array.isArray(rt.linkedRoomTypeQty)
          ? rt.linkedRoomTypeQty
              .map((v) => asRecord(v))
              .filter((v): v is Record<string, unknown> => !!v)
              .map((v) => ({
                roomTypeID: asString(v.roomTypeID) ?? "",
                roomQty: asNumber(v.roomQty) ?? 0,
              }))
              .filter((v) => v.roomTypeID.length > 0 && v.roomQty > 0)
          : undefined,
      },
      pricing: {
        ratePlans: [],
      },
    };

    const specsIndex = await fetchRoomTypeLocalSpecsIndex([params.roomTypeID]);
    const pricingIndex = await fetchRoomTypeLocalPricingIndex([params.roomTypeID]);
    return this.toReducedDetailModel(
      model,
      specsIndex.get(params.roomTypeID),
      { applyFallbackDefaults: false, portadaOnly: true, includePortadaMenu: true },
      pricingIndex.get(params.roomTypeID)
    );
  },

  async getRoomTypeReducedDetailWithPricing(params: {
    roomTypeID: string;
    startDate: string;
    endDate: string;
    maxGuests?: number;
    promoCode?: string;
  }): Promise<RoomTypeReducedDetailModel | null> {
    const full = await this.getRoomTypeWithPricing(params);
    if (!full) return null;

    return this.toReducedDetailModel(full, undefined, { applyFallbackDefaults: false });
  },
  };
