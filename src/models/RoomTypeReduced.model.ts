import type { RoomTypeBedroomSpec } from "./RoomTypeLocalSpecs";

export type RoomTypeReducedModel = {
  roomTypeID: string;
  roomTypeName: string;
  roomTypePhotos?: string[];
  portada?: string | null;
  posicion_fotos_portadas?: Record<string, unknown> | null;
  maxGuests?: number;
  bedroomsCount?: number;
  bathroomsCount?: number;
  pricing: {
    totalRate?: number;
    ofertaDelMesRoomRate?: number;
  };
};

export type RoomTypeReducedDetailModel = RoomTypeReducedModel & {
  roomTypeDescription?: string;
  roomTypeFeatures?: string[];
  bedrooms?: RoomTypeBedroomSpec[];
  portadaMenu?: string | null;
};
