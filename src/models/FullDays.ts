import mongoose, { Document, Schema } from "mongoose";

/**
 * El horario es siempre 9am–6pm y el paquete no tiene vigencia por fechas, así que ni la duración
 * ni el rango de fechas se guardan: la franja la muestra el front como texto fijo.
 */
export type FullDayType = Document & {
  nombre: string;
  descripcion: string;
  /** Traducción persistida, resuelta la primera vez que se pide `idioma=en`. */
  nombreEn?: string | null;
  descripcionEn?: string | null;
  idealParaEn?: string | null;
  idealPara: string;
  cuposMaximos: number;
  imagen: string;
  /** Lista libre definida por el admin (ej. "Almuerzo buffet", "Piscina", "Traslado"). */
  incluye: string[];
  incluyeEn?: string[];
  /** Itinerario/actividades del día, en orden. */
  itinerario: string[];
  itinerarioEn?: string[];
  precioPorPersona: number;
  disponible: boolean;
  fechaRegistro?: Date;
};

const FullDaySchema: Schema = new Schema(
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
      type: [String],
      default: [],
    },
    incluyeEn: {
      type: [String],
      default: undefined,
    },
    itinerario: {
      type: [String],
      default: [],
    },
    itinerarioEn: {
      type: [String],
      default: undefined,
    },
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
    collection: "fulldays",
  }
);

const FullDay = mongoose.model<FullDayType>("FullDays", FullDaySchema);

export default FullDay;
