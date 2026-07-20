import mongoose, { Schema, Document } from "mongoose";

export const AREA_CATEGORIAS = ["AREAS", "ACTIVIDADES_GRUPALES"] as const;
export type AreaCategoria = (typeof AREA_CATEGORIAS)[number];

export type AreaType = Document & {
  nombre: string;
  descripcion: string;
  imagenes: string[];
  categoria: AreaCategoria;
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
  imagenes: {
    type: [String],
    required: true,
    default: [],
  },
});

const Area = mongoose.model<AreaType>("Area", AreaSchema);

export default Area;
