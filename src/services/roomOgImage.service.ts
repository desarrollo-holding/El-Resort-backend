// Imagen Open Graph de una propiedad: la que ven WhatsApp, Facebook y LinkedIn al compartir
// `/casa/<slug>`.
//
// POR QUÉ SE GENERA Y NO SE USA UNA FOTO TAL CUAL. La foto de la propiedad (`portada`) se encuadra
// desde el panel con un rectángulo por viewport (`posicion_fotos_portadas.portada`), y ese recorte
// es metadata que aplica el navegador: el bitmap subido nunca se recorta. `og:image` necesita la
// URL de un archivo real, así que el encuadre que eligió el admin no se podía usar para compartir.
// Además el encuadre móvil es vertical (0.80:1 en las dieciséis propiedades) y Open Graph pide
// 1200×630 — 1.91:1 apaisado—, así que publicarlo tal cual haría que las redes lo recortaran a una
// franja del centro, perdiendo justo lo que se había encuadrado.
//
// LO QUE HACE. Parte del encuadre móvil y lo ENSANCHA hasta 1.91:1 alrededor de su centro, usando
// más foto a los lados en vez de comer arriba y abajo. El sujeto que eligió el admin queda
// centrado y la tarjeta cumple la proporción recomendada. Solo cuando la foto no da más de sí a lo
// ancho se recorta en alto, que es el único caso en que no queda alternativa.
import sharp from "sharp";
import { enqueueImageWork, InvalidImageError } from "./imageOptimizer";

/** Tamaño recomendado de una imagen Open Graph (Facebook, LinkedIn y WhatsApp coinciden). */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
const OG_RATIO = OG_IMAGE_WIDTH / OG_IMAGE_HEIGHT;

/**
 * JPEG y no WebP a propósito: es el formato que cualquier scraper sabe leer. Las variantes que
 * sirve el pipeline normal son `.webp` porque las consume un navegador, pero acá del otro lado hay
 * bots viejos, y una previsualización que no carga es peor que unos kilobytes de más.
 */
const OG_JPEG_QUALITY = 82;

export type CropRect = { x: number; y: number; w: number; h: number };
export type ImageBounds = { width: number; height: number };

/**
 * `"x,y,w,h"` tal como lo guarda el panel en `posicion_fotos_portadas`. Devuelve `null` si el
 * string no trae cuatro números finitos con tamaño positivo: un encuadre a medias es lo mismo que
 * no tener encuadre, y el que llama cae a la foto entera.
 */
export function parseCropCoordinates(raw: unknown): CropRect | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((piece) => Number(piece.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;

  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** Mete un rectángulo dentro de la imagen, conservando su tamaño mientras quepa. */
function clampRect(rect: CropRect, bounds: ImageBounds): CropRect {
  const w = Math.min(Math.max(1, Math.round(rect.w)), bounds.width);
  const h = Math.min(Math.max(1, Math.round(rect.h)), bounds.height);
  const x = Math.min(Math.max(0, Math.round(rect.x)), bounds.width - w);
  const y = Math.min(Math.max(0, Math.round(rect.y)), bounds.height - h);
  return { x, y, w, h };
}

/**
 * El rectángulo 1.91:1 que mejor representa a `rect` dentro de la imagen.
 *
 * Construye el MENOR rectángulo de la proporción pedida que contiene al encuadre, lo achica solo
 * si no cabe en la foto, y lo centra en el centro del encuadre (corriéndolo lo justo para que
 * entre). Así, con una foto suficientemente ancha, no se pierde nada de lo encuadrado: se agrega
 * contexto a los lados. Con una foto angosta se recorta en alto, porque no hay otra.
 *
 * El rectángulo de entrada puede venir fuera de la imagen o más grande que ella —el panel lo
 * guarda en coordenadas del original y algunas fichas tienen valores que se pasan—, así que lo
 * primero es acotarlo.
 */
export function computeOgCrop(bounds: ImageBounds, rect: CropRect, ratio = OG_RATIO): CropRect {
  const base = clampRect(rect, bounds);
  const centerX = base.x + base.w / 2;
  const centerY = base.y + base.h / 2;

  let w = Math.round(Math.max(base.w, base.h * ratio));
  let h = Math.round(w / ratio);

  if (w > bounds.width) {
    w = bounds.width;
    h = Math.round(w / ratio);
  }
  if (h > bounds.height) {
    h = bounds.height;
    w = Math.round(h * ratio);
  }

  return clampRect({ x: Math.round(centerX - w / 2), y: Math.round(centerY - h / 2), w, h }, bounds);
}

/**
 * Recorta y codifica. `withoutEnlargement` NO se usa acá, al revés que en el pipeline de subida:
 * varias `portada` se cargaron por debajo de 1200 px de ancho y una previsualización algo blanda
 * es mejor que una que las redes degradan a miniatura por no llegar al mínimo.
 *
 * Va por la misma cola de un carril que el resto del trabajo de imagen (ver imageOptimizer): el
 * contenedor tiene poca memoria y dos pipelines de sharp a la vez duplican el pico.
 */
export async function renderOgImage(source: Buffer, rect: CropRect | null): Promise<Buffer> {
  return enqueueImageWork(async () => {
    let pipeline: sharp.Sharp;
    try {
      // El origen es siempre un `orig` de nuestro propio bucket (acotado a 2400 px por el pipeline
      // de subida), así que el tope no debería activarse nunca; está por el mismo motivo que en
      // imageOptimizer, que es no dejar que un archivo inesperado reviente la memoria del contenedor.
      const image = sharp(source, { failOn: "truncated", limitInputPixels: 80e6 }).rotate();
      const meta = await image.metadata();
      const bounds = { width: meta.width ?? 0, height: meta.height ?? 0 };
      if (!bounds.width || !bounds.height) {
        throw new InvalidImageError("Imagen inválida: no se pudieron leer sus dimensiones");
      }

      // Sin encuadre guardado se usa la foto entera, que `computeOgCrop` lleva igual a 1.91:1.
      const crop = computeOgCrop(bounds, rect ?? { x: 0, y: 0, w: bounds.width, h: bounds.height });
      pipeline = image.extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
    } catch (error) {
      if (error instanceof InvalidImageError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new InvalidImageError(`Imagen inválida: ${message}`);
    }

    return pipeline
      .resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, { fit: "cover" })
      // JPEG no tiene canal alfa: sin esto, un PNG transparente saldría con fondo negro.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: OG_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  });
}
