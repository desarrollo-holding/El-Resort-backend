import mongoose, { Schema, Document } from "mongoose";
import type { ImageAssetType } from "./shared/imageAsset";

export const AREA_CATEGORIAS = ["AREAS", "ACTIVIDADES_GRUPALES"] as const;
export type AreaCategoria = (typeof AREA_CATEGORIAS)[number];

/** `string` = dato previo a este pipeline; ver ./shared/imageAsset para el porqué de la unión. */
export type AreaImageField = ImageAssetType | string;

/**
 * Encuadre de la foto de la tarjeta (`imagenes[0]`), uno por viewport. Mismo formato que el resto
 * de encuadres del panel: `"x,y,ancho,alto"`, y siempre en píxeles del `orig` guardado (el
 * controlador reescala lo que mide el panel; ver `encuadreParaImagen`). El archivo nunca se recorta:
 * la web aplica el rectángulo al pintar la foto.
 */
export type AreaEncuadre = {
  desktop_coordinates: string;
  mobile_coordinates: string;
};

export type AreaType = Document & {
  nombre: string;
  descripcion: string;
  /** Traducción persistida de `nombre`/`descripcion`, resuelta la primera vez que se pide `idioma=en`. */
  nombreEn?: string | null;
  descripcionEn?: string | null;
  imagenes: AreaImageField[];
  /** `null` (o ausente, en áreas anteriores a este campo) = la foto se muestra centrada. */
  encuadreImagen?: AreaEncuadre | null;
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
    type: new Schema(
      {
        desktop_coordinates: { type: String, required: true },
        mobile_coordinates: { type: String, required: true },
      },
      { _id: false }
    ),
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
