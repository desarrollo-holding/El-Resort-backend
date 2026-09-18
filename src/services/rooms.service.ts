import { CloudbedsClient, CloudbedsHttpError, createCloudbedsClientFromEnv } from "../integrations/cloudbedsClient";

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

  CloudbedsHttpError,
};
