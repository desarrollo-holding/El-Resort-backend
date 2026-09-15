import type { RoomTypeBedroomSpec } from "./RoomTypeLocalSpecs";

export type RoomTypeReducedModel = {
  roomTypeID: string;
  roomTypeName: string;
  roomTypePhotos?: string[];
  portada?: string | null;
  /** Ya se incluye en la respuesta lite (`includePortadaMenu: true` en `listRoomTypesReducedCatalogWithLocalPricing`). */
  portadaMenu?: string | null;
  posicion_fotos_portadas?: Record<string, unknown> | null;
  maxGuests?: number;
  bedroomsCount?: number;
  bathroomsCount?: number;
  pricing: {
    totalRate?: number;
    ofertaDelMesRoomRate?: number;
  };
};

/** Beneficio del catálogo local: icono subido por el admin + texto en ambos idiomas. */
export type RoomTypeBeneficio = {
  _id: string;
  nombre: { es: string; en: string | null };
  iconUrl: string;
  orden: number;
};

export type RoomTypeReducedDetailModel = RoomTypeReducedModel & {
  roomTypeDescription?: string;
  /** Legado de Cloudbeds; solo se usa si `beneficios` viene vacío. */
  roomTypeFeatures?: string[];
  beneficios?: RoomTypeBeneficio[];
  bedrooms?: RoomTypeBedroomSpec[];
  portadaMenu?: string | null;
};
