import type { AreaEncuadre } from "../models/Area";
import type { ImageAssetType } from "../models/shared/imageAsset";
import { parseCropCoordinates, type CropRect } from "../services/roomOgImage.service";

type Medidas = { width: number; height: number };

/**
 * Lo que llega en `encuadreImagen` al crear o editar un área.
 *
 * - `ausente`: el campo no vino. Lo guardado no se toca, salvo que cambie la foto (un encuadre es
 *   de una foto concreta; ver `patchAreaById`).
 * - `borrar`: `null`, `""` o `"null"`. La foto vuelve a mostrarse centrada en la web.
 * - `fijar`: las dos coordenadas válidas y, opcionalmente, el tamaño en píxeles de la imagen sobre la
 *   que el panel las midió (`source_width`/`source_height`).
 * - `invalido`: vino algo que no se puede interpretar. Se responde 400 en vez de guardar un encuadre a
 *   medias: la web lo aplicaría igual y la foto quedaría corrida sin que nadie sepa por qué.
 */
export type EncuadreEntrada =
  | { tipo: "ausente" }
  | { tipo: "borrar" }
  | { tipo: "fijar"; encuadre: AreaEncuadre; origen: Medidas | null }
  | { tipo: "invalido"; error: string };

const ERROR_FORMATO =
  'encuadreImagen necesita desktop_coordinates y mobile_coordinates con el formato "x,y,ancho,alto"';

const serializar = (rect: CropRect): string => `${rect.x},${rect.y},${rect.w},${rect.h}`;

/**
 * Acepta el objeto tal cual (body JSON) o como texto JSON (multipart, que es como llega cuando en la
 * misma petición viaja el archivo de la foto).
 */
export function parseEncuadreEntrada(raw: unknown): EncuadreEntrada {
  if (raw === undefined) return { tipo: "ausente" };
  if (raw === null) return { tipo: "borrar" };

  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "null") return { tipo: "borrar" };
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { tipo: "invalido", error: "encuadreImagen debe ser un objeto JSON" };
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { tipo: "invalido", error: ERROR_FORMATO };
  }

  const input = value as Record<string, unknown>;
  const desktop = parseCropCoordinates(input.desktop_coordinates);
  const mobile = parseCropCoordinates(input.mobile_coordinates);
  if (!desktop || !mobile) return { tipo: "invalido", error: ERROR_FORMATO };

  let origen: Medidas | null = null;
  if (input.source_width !== undefined || input.source_height !== undefined) {
    const width = Number(input.source_width);
    const height = Number(input.source_height);
    if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
      return { tipo: "invalido", error: "source_width y source_height deben ser números positivos" };
    }
    origen = { width, height };
  }

  return {
    tipo: "fijar",
    encuadre: { desktop_coordinates: serializar(desktop), mobile_coordinates: serializar(mobile) },
    origen,
  };
}

/** Diferencia de proporción a partir de la cual el origen declarado no describe el archivo guardado. */
const TOLERANCIA_PROPORCION = 0.02;

function llevarAlDestino(rect: CropRect, origen: Medidas | null, destino: Medidas | null): CropRect {
  let { x, y, w, h } = rect;
  if (origen && destino && (origen.width !== destino.width || origen.height !== destino.height)) {
    const sx = destino.width / origen.width;
    const sy = destino.height / origen.height;
    x *= sx;
    w *= sx;
    y *= sy;
    h *= sy;
  }

  // Sin alguna de las dos medidas no se sabe en qué escala están las coordenadas, así que tampoco
  // se puede acotar: meter a la fuerza en una foto de 2400 un recorte medido sobre una de 4032 lo
  // correría en silencio. Se guardan como vinieron y la web aplica su propia corrección.
  if (!origen || !destino) {
    return { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  }

  // Redondear cada valor por separado puede dejar el rectángulo un píxel afuera de la imagen: se
  // acota conservando el tamaño mientras quepa.
  const cw = Math.min(Math.max(1, Math.round(w)), destino.width);
  const ch = Math.min(Math.max(1, Math.round(h)), destino.height);
  return {
    x: Math.min(Math.max(0, Math.round(x)), destino.width - cw),
    y: Math.min(Math.max(0, Math.round(y)), destino.height - ch),
    w: cw,
    h: ch,
  };
}

/**
 * Lleva el encuadre a píxeles del archivo que quedó guardado, que es lo que la web espera.
 *
 * POR QUÉ HACE FALTA. El panel mide las coordenadas sobre la foto tal como la eligió el admin, pero
 * el servidor la recodifica acotando el lado mayor a 2400 px (`imageOptimizer`, perfil `default`).
 * Una foto de celular de 4032×3024 se guarda como 2400×1800, y un recorte medido sobre la de 4032
 * apuntaría a cualquier parte de la de 2400. `CarouselFramedSlideImage` tiene una corrección por
 * heurística, pero solo acierta si el recorte toca un borde de la foto, o sea, si el admin no hizo
 * zoom: justo lo contrario de reencuadrar. Acá el factor se conoce exacto, porque el panel manda el
 * tamaño sobre el que midió y el asset trae el tamaño guardado.
 *
 * Devuelve `null` sin foto (no hay nada que encuadrar) y cuando la proporción del origen declarado no
 * coincide con la del archivo guardado: eso pasa si alguno de los dos no aplicó la rotación EXIF, y
 * escalar ancho y alto por factores distintos deformaría el recorte. Mejor la foto centrada que un
 * encuadre que no es el que se eligió; el admin puede volver a encuadrarla sobre el archivo ya guardado.
 */
export function encuadreParaImagen(
  encuadre: AreaEncuadre,
  origen: Medidas | null,
  imagen: ImageAssetType | null
): AreaEncuadre | null {
  if (!imagen) return null;

  const destino = imagen.width && imagen.height ? { width: imagen.width, height: imagen.height } : null;
  if (origen && destino) {
    const proporcionOrigen = origen.width / origen.height;
    const proporcionDestino = destino.width / destino.height;
    if (Math.abs(proporcionOrigen - proporcionDestino) / proporcionDestino > TOLERANCIA_PROPORCION) {
      console.warn(
        `[Area] encuadre descartado: medido sobre ${origen.width}x${origen.height} y la foto guardada mide ${destino.width}x${destino.height}`
      );
      return null;
    }
  }

  const desktop = parseCropCoordinates(encuadre.desktop_coordinates);
  const mobile = parseCropCoordinates(encuadre.mobile_coordinates);
  if (!desktop || !mobile) return null;

  return {
    desktop_coordinates: serializar(llevarAlDestino(desktop, origen, destino)),
    mobile_coordinates: serializar(llevarAlDestino(mobile, origen, destino)),
  };
}
