import mongoose, { Schema, Document } from "mongoose";
import type { ImageAssetType } from "./shared/imageAsset";

export const AREA_CATEGORIAS = ["AREAS", "ACTIVIDADES_GRUPALES"] as const;
export type AreaCategoria = (typeof AREA_CATEGORIAS)[number];

/** `string` = dato previo a este pipeline; ver ./shared/imageAsset para el porqué de la unión. */
export type AreaImageField = ImageAssetType | string;

export type AreaType = Document & {
  nombre: string;
  descripcion: string;
  imagenes: AreaImageField[];
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
  orden: {
    type: Number,
    required: false,
    index: true,
  },
});

const Area = mongoose.model<AreaType>("Area", AreaSchema);

export default Area;
