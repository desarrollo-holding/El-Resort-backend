// Imagen Open Graph de una propiedad: la que ven WhatsApp, Facebook y LinkedIn al compartir
// `/casa/<slug>`.
//
// DE QUÉ FOTO SALE. De `portadaMenu` —el hero de escritorio de la ficha— con su encuadre de
// escritorio (`posicion_fotos_portadas.portadaMenu.desktop_coordinates`), que es el que el panel
// enseña en «Vista previa en hero del detalle». Antes salía del encuadre móvil de `portada`, que es
// vertical (0.80:1): para llegar a 1.91:1 había que inventarle foto a los lados o comerle alto, y la
// tarjeta no se parecía a nada de lo que el admin había visto. El de escritorio ya es apaisado
// (1200×460), así que la tarjeta queda casi igual a esa vista previa. `portada` queda solo de
// respaldo para una propiedad que todavía no tenga `portadaMenu` (ver `pickOgSource`).
//
// POR QUÉ SE GENERA Y NO SE USA LA FOTO TAL CUAL. El encuadre del panel es metadata que aplica el
// navegador: el bitmap subido nunca se recorta. `og:image` necesita la URL de un archivo real, así
// que sin generarla el encuadre que eligió el admin no se podía usar para compartir. Y Open Graph
// pide 1200×630 (1.91:1): publicar otra proporción hace que cada red la recorte a su manera.
//
// LO QUE HACE. Parte del encuadre y lo AGRANDA hasta 1.91:1 alrededor de su centro, sumando foto
// por el lado que le falte (arriba y abajo para el de escritorio, que es más apaisado que 1.91:1;
// a los lados para el móvil). Solo cuando la foto no da más de sí se recorta el propio encuadre,
// que es el único caso en que no queda alternativa.
import sharp from "sharp";
import { enqueueImageWork, InvalidImageError } from "./imageOptimizer";
import { normalizeImageAsset } from "../models/shared/imageAsset";

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

/** Foto de la que se genera la imagen y el encuadre del panel que le corresponde. */
export type OgSource = { field: "portadaMenu" | "portada"; url: string; rect: CropRect | null };

/** URL del original de un campo de foto (asset o string suelto): se recorta de él, no de una variante. */
function sourceUrlOf(value: unknown): string | null {
  const url = normalizeImageAsset(value)?.url ?? "";
  return /^https?:\/\//i.test(url) ? url : null;
}

function framingOf(posicion: unknown, field: OgSource["field"]): Record<string, unknown> | undefined {
  if (!posicion || typeof posicion !== "object" || Array.isArray(posicion)) return undefined;
  const slot = (posicion as Record<string, unknown>)[field];
  return slot && typeof slot === "object" && !Array.isArray(slot) ? (slot as Record<string, unknown>) : undefined;
}

/**
 * `portadaMenu` con su encuadre de ESCRITORIO; si la propiedad todavía no la tiene, `portada` con su
 * encuadre MÓVIL (el único que el panel ajusta para ese campo). Cada foto con el suyo: las
 * coordenadas son píxeles de ese archivo, y aplicarlas sobre el otro recortaría una zona cualquiera.
 * `null` si no hay ninguna de las dos.
 *
 * El frontend arma la huella `?v=` de la URL con esta misma regla (scripts/roomOgImage.mjs): si
 * cambia acá, cambiarla allá, o el cambio de foto no llegará a los links ya compartidos.
 */
export function pickOgSource(doc: {
  portada?: unknown;
  portadaMenu?: unknown;
  posicion_fotos_portadas?: unknown;
} | null | undefined): OgSource | null {
  if (!doc) return null;

  const menuUrl = sourceUrlOf(doc.portadaMenu);
  if (menuUrl) {
    const framing = framingOf(doc.posicion_fotos_portadas, "portadaMenu");
    return { field: "portadaMenu", url: menuUrl, rect: parseCropCoordinates(framing?.desktop_coordinates) };
  }

  const portadaUrl = sourceUrlOf(doc.portada);
  if (portadaUrl) {
    const framing = framingOf(doc.posicion_fotos_portadas, "portada");
    return { field: "portada", url: portadaUrl, rect: parseCropCoordinates(framing?.mobile_coordinates) };
  }

  return null;
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
 * entre). Así, mientras la foto dé, no se pierde nada de lo encuadrado: se agrega contexto a los
 * lados (encuadre vertical) o arriba y abajo (encuadre más apaisado que 1.91:1, como el de
 * escritorio). Si la foto no da, se recorta el encuadre en la otra dimensión, porque no hay otra.
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
 * varias fotos se cargaron por debajo de 1200 px de ancho y una previsualización algo blanda
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
