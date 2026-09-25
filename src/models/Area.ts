import mongoose, { Schema, Document } from "mongoose";
import type { ImageAssetType } from "./shared/imageAsset";
import { encuadreImagenSchema, type EncuadreImagen } from "./shared/encuadreImagen";

export const AREA_CATEGORIAS = ["AREAS", "ACTIVIDADES_GRUPALES"] as const;
export type AreaCategoria = (typeof AREA_CATEGORIAS)[number];

/** `string` = dato previo a este pipeline; ver ./shared/imageAsset para el porqué de la unión. */
export type AreaImageField = ImageAssetType | string;


export type AreaType = Document & {
  nombre: string;
  descripcion: string;
  /** Traducción persistida de `nombre`/`descripcion`, resuelta la primera vez que se pide `idioma=en`. */
  nombreEn?: string | null;
  descripcionEn?: string | null;
  imagenes: AreaImageField[];
  /** `null` (o ausente, en áreas anteriores a este campo) = la foto se muestra centrada. */
  /** Encuadre de `imagenes[0]` en la tarjeta. */
  encuadreImagen?: EncuadreImagen | null;
  categoria: AreaCategoria;
  orden?: number;
};

const AreaSchema: Schema = new Schema({
  nombre: {
    type: String,
    required: true,
    trim: true,
  },
  descripcion: {
    type: String,
    default: "",
    trim: true,
  },
  nombreEn: {
    type: String,
    default: null,
  },
  descripcionEn: {
    type: String,
    default: null,
  },
  categoria: {
    type: String,
    enum: AREA_CATEGORIAS,
    required: true,
    trim: true,
  },
  // Mixed a propósito: acepta el `ImageAssetType` de las subidas nuevas y el `string` suelto
  // de áreas creadas antes de este pipeline (ver ./shared/imageAsset).
  imagenes: {
    type: [Schema.Types.Mixed],
    required: true,
    default: [],
  },
  encuadreImagen: {
    type: encuadreImagenSchema,
    default: null,
  },
  orden: {
    type: Number,
    required: false,
    index: true,
  },
});

const Area = mongoose.model<AreaType>("Area", AreaSchema);

export default Area;
