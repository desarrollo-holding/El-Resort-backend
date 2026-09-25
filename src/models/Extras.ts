import mongoose, { Schema, Document } from "mongoose";
import type { ImageAssetType } from "./shared/imageAsset";
import { encuadreImagenSchema, type EncuadreImagen } from "./shared/encuadreImagen";

/** `string` = dato previo a este pipeline; ver ./shared/imageAsset para el porqué de la unión. */
export type ExtraImageField = ImageAssetType | string;

// Esto es de Typescript
export type ExtraType = Document & {
  nombre: string;
  precio: number;
  descripcion: string;
  /** Traducción persistida de `nombre`/`descripcion`, resuelta la primera vez que se pide `idioma=en`. */
  nombreEn?: string | null;
  descripcionEn?: string | null;
  grupo?: string;
  minPersonas: number;
  personas: number;
  montoAdicional: number;
  stock: number;
  imagenes: ExtraImageField[];
  /** Encuadre de `imagenes[0]` en la tarjeta de Actividades personalizadas. `null` = foto centrada. */
  encuadreImagen?: EncuadreImagen | null;
  diasNoDisponibles?: string[];
  fechasBloqueadas?: {
    inicio: Date;
    fin: Date;
  }[];
  duracion: number; // Duración en minutos
  areas?: {
    nombre: string; // Nombre del área
    horarios: string[]; // Lista de horarios en formato "HH:mm"
    stockArea: number;
  }[];
  orden?: number;
};

// Esto es de Mongoose
const ExtraSchema: Schema = new Schema({
  nombre: {
    type: String,
    required: true,
    trim: true,
  },
  precio: {
    type: Number,
    required: true,
    trim: true,
  },
  descripcion: {
    type: String,
    required: true,
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
  grupo: {
    type: String,
    required: false,
    trim: true,
  },
  minPersonas: {
    type: Number,
    required: false,
  },
  personas: {
    type: Number,
    required: false,
  },
  montoAdicional: {
    type: Number,
    required: false,
  },
  stock: {
    type: Number,
    required: false,
  },
  // Mixed a propósito: acepta el `ImageAssetType` de las subidas nuevas y el `string` suelto
  // de extras creados antes de este pipeline (ver ./shared/imageAsset).
  imagenes: {
    type: [Schema.Types.Mixed],
    required: false,
  },
  encuadreImagen: {
    type: encuadreImagenSchema,
    default: null,
  },
  diasNoDisponibles: {
    type: [String],
    required: false,
  },
  fechasBloqueadas: {
    type: [
      {
        inicio: { type: Date, required: true },
        fin: { type: Date },
      },
    ],
    required: false,
  },
  duracion: {
    type: Number, // Duración en minutos
    required: false,
    default: 0,
  },
  areas: {
    type: [
      {
        nombre: { type: String, required: true }, // Nombre del área
        horarios: { type: [String], required: true, trim: true }, // Lista de horarios
        stockArea: { type: Number, required: true }, // Stock para el área
      },
    ],
    required: false,
  },
  orden: {
    type: Number,
    default: 0,
  },
});

const Extra = mongoose.model<ExtraType>("Extra", ExtraSchema);

export default Extra;
