import mongoose, { Schema, Document } from "mongoose";

// Esto es de Typescript
export type ExtraType = Document & {
  nombre: string;
  precio: number;
  descripcion: string;
  grupo?: string;
  minPersonas: number;
  personas: number;
  montoAdicional: number;
  stock: number;
  imagenes: string[];
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
  imagenes: {
    type: [String],
    required: false,
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
});

const Extra = mongoose.model<ExtraType>("Extra", ExtraSchema);

export default Extra;
