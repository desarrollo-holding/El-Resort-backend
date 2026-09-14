import mongoose, { Document, Schema } from "mongoose";

export type RetiroType = Document & {
  nombre: string;
  descripcion: string;
  /** Traducción persistida, resuelta la primera vez que se pide `idioma=en`. */
  nombreEn?: string | null;
  descripcionEn?: string | null;
  idealParaEn?: string | null;
  duracionNoches: number;
  fechaInicio: Date;
  fechaFin: Date;
  idealPara: string;
  cuposMaximos: number;
  imagen: string;
  incluye: {
    yoga: boolean;
    comidasPorDia: number;
    masajesIncluidos: boolean;
    trasladoIncluido: boolean;
  };
  actividades: {
    _id: mongoose.Types.ObjectId;
    dia: number;
    actividadesDelDia: string[];
    actividadesDelDiaEn?: string[];
  }[];
  precioPorPersona: number;
  disponible: boolean;
  fechaRegistro?: Date;
};

const RetiroSchema: Schema = new Schema(
  {
    nombre: {
      type: String,
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
    idealParaEn: {
      type: String,
      default: null,
    },
    duracionNoches: {
      type: Number,
      required: true,
    },
    fechaInicio: {
      type: Date,
      required: true,
    },
    fechaFin: {
      type: Date,
      required: true,
    },
    idealPara: {
      type: String,
      required: true,
      trim: true,
    },
    cuposMaximos: {
      type: Number,
      required: true,
    },
    imagen: {
      type: String,
      required: true,
      trim: true,
    },
    incluye: {
      yoga: { type: Boolean, required: true },
      comidasPorDia: { type: Number, required: true },
      masajesIncluidos: { type: Boolean, required: true },
      trasladoIncluido: { type: Boolean, required: true },
    },
    actividades: [
      {
        dia: { type: Number, required: true },
        actividadesDelDia: { type: [String], required: true },
        actividadesDelDiaEn: { type: [String], default: undefined },
      },
    ],
    precioPorPersona: {
      type: Number,
      required: true,
    },
    disponible: {
      type: Boolean,
      required: true,
      default: true,
    },
    fechaRegistro: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "retiros",
  }
);

const Retiro = mongoose.model<RetiroType>("Retiros", RetiroSchema);

export default Retiro;
