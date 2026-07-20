import { CloudbedsClient, CloudbedsHttpError, createCloudbedsClientFromEnv } from "../integrations/cloudbedsClient";
import { RatesService } from "./rates.service";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type GetRoomsParams = {
  propertyIDs?: string;
  roomTypeID?: string;
  roomTypeNameShort?: string;
  startDate?: string;
  endDate?: string;
  includeRoomRelations?: number;
  pageNumber?: number;
  pageSize?: number;
  sort?: string;
};

export type GetRoomTypesParams = {
  propertyIDs?: string;
  roomTypeIDs?: string;
  startDate?: string;
  endDate?: string;
  adults?: number;
  children?: number;
  detailedRates?: boolean;
  roomTypeName?: string;
  propertyCity?: string;
  propertyName?: string;
  maxGuests?: string;
  pageNumber?: number;
  pageSize?: number;
  sort?: string;
};

let cachedClient: CloudbedsClient | null = null;
const getClient = () => {
  if (!cachedClient) cachedClient = createCloudbedsClientFromEnv();
  return cachedClient;
};

// Cache de todos los roomTypes de CloudBeds (se invalida cada 5 min)
let allRoomTypesCache: Map<string, JsonObject> | null = null;
let allRoomTypesCacheTime = 0;

// Cache de precios CloudBeds por roomTypeID (se invalida cada 5 min)
let cloudBedsRatesCache: Map<string, { totalRate?: number; ofertaRate?: number }> | null = null;
let cloudBedsRatesCacheTime = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchAllRoomTypesMap(): Promise<Map<string, JsonObject>> {
  const now = Date.now();
  if (allRoomTypesCache && now - allRoomTypesCacheTime < CACHE_TTL_MS) {
    return allRoomTypesCache;
  }

  const map = new Map<string, JsonObject>();
  let pageNumber = 1;
  const pageSize = 50;
  let lastTotal: number | undefined;
  while (pageNumber <= 200) {
    const raw = await RoomsService.getRoomTypes({ pageNumber, pageSize });
    const data = Array.isArray((raw as any).data) ? (raw as any).data : [];
    for (const item of data) {
      const id = typeof item.roomTypeID === "string" ? item.roomTypeID : undefined;
      if (id) map.set(id, item);
    }
    const total = typeof (raw as any).total === "number" ? (raw as any).total : undefined;
    if (total !== undefined && total > 0) lastTotal = total;
    if (lastTotal !== undefined && map.size >= lastTotal) break;
    if (data.length === 0) break;
    pageNumber++;
  }

  allRoomTypesCache = map;
  allRoomTypesCacheTime = now;
  return map;
}

export const RoomsService = {
  async getRooms(params: GetRoomsParams = {}): Promise<JsonObject> {
    const client = getClient();

    const response = await client.requestJson<JsonObject>({
      method: "GET",
      path: "/getRooms",
      params,
    });

    return response;
  },

  async getRoomTypes(params: GetRoomTypesParams = {}): Promise<JsonObject> {
    const client = getClient();

    const response = await client.requestJson<JsonObject>({
      method: "GET",
      path: "/getRoomTypes",
      params: {
        ...params,
        detailedRates: params.detailedRates === true ? true : undefined,
      },
    });

    return response;
  },

  async getAllRoomTypesMap(): Promise<Map<string, JsonObject>> {
    return fetchAllRoomTypesMap();
  },

  /** Cache de precios CloudBeds (baseRate) por roomTypeID. TTL 5 min. Usa getRatePlans endpoint. */
  async getCloudBedsRatesMap(): Promise<Map<string, { totalRate?: number; ofertaRate?: number }>> {
    const now = Date.now();
    if (cloudBedsRatesCache && now - cloudBedsRatesCacheTime < CACHE_TTL_MS) {
      return cloudBedsRatesCache;
    }

    const map = new Map<string, { totalRate?: number; ofertaRate?: number }>();

    try {
      // Obtener todos los roomTypeIDs del cache de roomTypes
      const typesMap = await RoomsService.getAllRoomTypesMap();
      const allIds = Array.from(typesMap.keys());
      if (allIds.length === 0) return map;

      const today = new Date().toISOString().split("T")[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

      // getRatePlans acepta hasta ~50 IDs por request; particionar si necesario
      const chunkSize = 50;
      for (let i = 0; i < allIds.length; i += chunkSize) {
        const chunk = allIds.slice(i, i + chunkSize);
        const raw = await RatesService.getRatePlans({
          roomTypeID: chunk.join(","),
          startDate: today,
          endDate: tomorrow,
          includePromoCode: false,
        });

        const data = Array.isArray((raw as any).data) ? (raw as any).data : [];
        for (const item of data) {
          const id = typeof item.roomTypeID === "string" ? item.roomTypeID : undefined;
          const isDerived = typeof item.isDerived === "boolean" ? item.isDerived : undefined;
          const roomRate = typeof item.roomRate === "number" ? item.roomRate : undefined;
          const totalRate = typeof item.totalRate === "number" ? item.totalRate : undefined;
          if (!id || isDerived === undefined || totalRate === undefined) continue;

          const entry = map.get(id) ?? { totalRate: undefined, ofertaRate: undefined };

          if (isDerived === false) {
            // baseRate: primera tarifa no derivada
            if (entry.totalRate === undefined) entry.totalRate = totalRate;
          } else {
            // ratePlan derivado: verificar si es "Oferta del Mes"
            const planName = typeof item.ratePlanNamePublic === "string" ? item.ratePlanNamePublic.trim() : "";
            if (planName === "Oferta del Mes" && entry.ofertaRate === undefined) {
              entry.ofertaRate = roomRate ?? totalRate;
            }
          }

          map.set(id, entry);
        }
      }
    } catch {
      // Si CloudBeds no responde, devolver cache anterior o vacío
    }

    cloudBedsRatesCache = map;
    cloudBedsRatesCacheTime = now;
    return map;
  },

  CloudbedsHttpError,
};
