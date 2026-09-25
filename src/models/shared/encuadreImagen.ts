import { Schema } from "mongoose";

/**
 * Encuadre de la foto de una tarjeta, uno por viewport. Mismo formato que el resto de encuadres del
 * panel: `"x,y,ancho,alto"`, y siempre en píxeles del archivo guardado (el controlador reescala lo
 * que mide el panel; ver `encuadreParaImagen`). El archivo nunca se recorta: la web aplica el
 * rectángulo al pintar la foto.
 *
 * Lo comparten las áreas (Áreas comunes y Actividades grupales) y los retiros.
 */
export type EncuadreImagen = {
  desktop_coordinates: string;
  mobile_coordinates: string;
};

/** Subdocumento para el campo `encuadreImagen`, con `default: null` en cada modelo que lo use. */
export const encuadreImagenSchema = new Schema<EncuadreImagen>(
  {
    desktop_coordinates: { type: String, required: true },
    mobile_coordinates: { type: String, required: true },
  },
  { _id: false }
);
