import type { RoomTypeBedroomSpec } from "./RoomTypeLocalSpecs";

export type RoomTypeReducedModel = {
  roomTypeID: string;
  roomTypeName: string;
  roomTypePhotos: string[];
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
};
