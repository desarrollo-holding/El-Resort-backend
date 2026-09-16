import mongoose, { Schema, Document } from "mongoose";
import type { ImageAssetType } from "./shared/imageAsset";

/**
 * `photos`/`portada`/`portadaMenu`/`extraGalleryImages` guardan `ImageAssetType` (imagen +
 * variantes) para las subidas nuevas, pero un documento creado antes de este pipeline tiene un
 * `string` suelto en el mismo lugar. Se tipa como unión y `normalizeImageAsset(Array)` (en
 * `./shared/imageAsset`) es la única forma soportada de leerlo — ver el comentario de ese
 * archivo para el porqué de no forzar un esquema tipado.
 */
export type RoomTypeImageField = ImageAssetType | string;

export type RoomTypeBedroomSpec = {
  number: number;
  description?: string;
  photos: RoomTypeImageField[];
};

export type RoomTypeLocalSpecsType = Document & {
  roomTypeID: string;
  bathroomsCount: number;
  titleColor?: string | null;
  orden?: number;
  isActive: boolean;
  bedrooms: RoomTypeBedroomSpec[];
  portada?: RoomTypeImageField | null;
  portadaMenu?: RoomTypeImageField | null;
  posicion_fotos_portadas?: Record<string, unknown> | null;
  /** Vídeo de escritorio. Campo histórico: los documentos previos al corte por breakpoint lo usaban para ambos. */
  video_url: string[];
  /** Vídeo vertical para móvil; vacío = el detalle público cae al de escritorio. */
  video_url_mobile: string[];
  portada_video?: string | null;
  extraGalleryImages: RoomTypeImageField[];
  pricing?: {
    totalRate?: number;
    ofertaDelMesRoomRate?: number;
  };
  condominioID?: mongoose.Types.ObjectId;
  /** Beneficios del catálogo que esta propiedad muestra. Vacío = se cae a los de Cloudbeds. */
  beneficios: mongoose.Types.ObjectId[];
  /** Nombre/descripción locales; `es` vacío = se cae al dato de Cloudbeds (ver roomTypesShow.service.ts). */
  roomTypeName?: { es: string; en?: string | null };
  roomTypeDescription?: { es: string; en?: string | null };
  /** Huéspedes máximos local; `null`/no seteado = se cae al dato de Cloudbeds. */
  maxGuests?: number | null;
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
          // Mixed a propósito: acepta tanto el `ImageAssetType` de las subidas nuevas como el
          // `string` suelto de documentos previos a este pipeline (ver ./shared/imageAsset).
          photos: { type: [Schema.Types.Mixed], required: true, default: [] },
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
    video_url_mobile: {
      type: [String],
      required: true,
      default: [],
    },
    portada: {
      type: Schema.Types.Mixed,
      required: false,
      default: null,
    },
    portadaMenu: {
      type: Schema.Types.Mixed,
      required: false,
      default: null,
    },
    portada_video: {
      type: String,
      required: false,
      default: null,
    },
    extraGalleryImages: {
      type: [Schema.Types.Mixed],
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
    beneficios: {
      type: [{ type: Schema.Types.ObjectId, ref: "Beneficio" }],
      required: true,
      default: [],
      index: true,
    },
    roomTypeName: {
      es: { type: String, required: false, trim: true },
      en: { type: String, required: false, default: null },
    },
    roomTypeDescription: {
      es: { type: String, required: false, trim: true },
      en: { type: String, required: false, default: null },
    },
    maxGuests: {
      type: Number,
      required: false,
      default: null,
      min: 1,
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
