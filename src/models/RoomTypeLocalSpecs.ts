import mongoose, { Schema, Document } from "mongoose";

export type RoomTypeBedroomSpec = {
  number: number;
  description?: string;
  photos: string[];
};

export type RoomTypeLocalSpecsType = Document & {
  roomTypeID: string;
  bathroomsCount: number;
  titleColor?: string | null;
  orden?: number;
  isActive: boolean;
  bedrooms: RoomTypeBedroomSpec[];
  portada?: string | null;
  portadaMenu?: string | null;
  posicion_fotos_portadas?: Record<string, unknown> | null;
  video_url: string[];
  portada_video?: string | null;
  extraGalleryImages: string[];
  pricing?: {
    totalRate?: number;
    ofertaDelMesRoomRate?: number;
  };
  condominioID?: mongoose.Types.ObjectId;
};

const RoomTypeLocalSpecsSchema: Schema = new Schema(
  {
    roomTypeID: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    bathroomsCount: {
      type: Number,
      required: true,
      min: 0,
    },
    titleColor: {
      type: String,
      required: false,
      default: null,
    },
    bedrooms: {
      type: [
        {
          number: { type: Number, required: true, min: 1 },
          description: { type: String, required: false, trim: true },
          photos: { type: [String], required: true, default: [] },
        },
      ],
      required: true,
      default: [],
    },
    video_url: {
      type: [String],
      required: true,
      default: [],
    },
    portada: {
      type: String,
      required: false,
      default: null,
    },
    portadaMenu: {
      type: String,
      required: false,
      default: null,
    },
    portada_video: {
      type: String,
      required: false,
      default: null,
    },
    extraGalleryImages: {
      type: [String],
      required: true,
      default: [],
    },
    posicion_fotos_portadas: {
      type: Schema.Types.Mixed,
      required: false,
      default: null,
    },
    orden: {
      type: Number,
      required: false,
      index: true,
    },
    pricing: {
      totalRate: { type: Number, required: false, min: 0 },
      ofertaDelMesRoomRate: { type: Number, required: false, min: 0 },
    },
    condominioID: {
      type: Schema.Types.ObjectId,
      ref: "Condominio",
      required: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

const RoomTypeLocalSpecs = mongoose.model<RoomTypeLocalSpecsType>("RoomTypeLocalSpecs", RoomTypeLocalSpecsSchema);

export default RoomTypeLocalSpecs;
