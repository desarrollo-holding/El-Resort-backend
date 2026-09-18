import { RoomsService, type JsonObject } from "../../services/rooms.service";

/** Igual que RoomsService.getAllRoomTypesMap(), pero nunca lanza — si CloudBeds no está disponible se usan solo datos locales. */
export const fetchCloudbedsRoomTypesMapSafe = async (): Promise<Map<string, JsonObject>> => {
  try {
    return await RoomsService.getAllRoomTypesMap();
  } catch {
    return new Map();
  }
};

/**
 * Antes caia a las tarifas de Cloudbeds cuando la propiedad no tenia precio local. Cloudbeds ya no
 * esta, y las 16 propiedades activas tienen `pricing.totalRate > 0` en Mongo, asi que el respaldo
 * no tenia a quien rescatar. Se mantiene la firma para no reescribir admin.ts/crud.ts: devolver un
 * mapa vacio es exactamente lo que devolvia desde que se quitaron las variables CLOUDBEDS_*.
 */
export const fetchCloudbedsRatesMapSafe = async (): Promise<Map<string, { totalRate?: number; ofertaRate?: number }>> =>
  new Map();
