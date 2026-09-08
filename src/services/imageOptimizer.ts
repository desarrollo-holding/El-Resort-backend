import sharp from "sharp";

// Sin caché de operaciones ni hilos en paralelo dentro de un pipeline: el proceso corre
// en un contenedor con poca memoria y la prioridad es no crecer, no ir rápido.
sharp.cache(false);
sharp.concurrency(1);

// Un JPEG de 80 megapíxeles ocupa ~320 MB decodificado; por encima se rechaza la subida.
const LIMIT_INPUT_PIXELS = 80e6;

// `failOn: "truncated"` tolera avisos benignos de libvips (ICC/EXIF raros de cámaras) pero
// rechaza un archivo cuyos píxeles terminan antes de tiempo: con "none" una subida cortada
// a medias se publicaría como imagen con la mitad inferior gris.
const INPUT_OPTIONS: sharp.SharpOptions = { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: "truncated" };

// Anchos candidatos para el srcset. Solo se generan los estrictamente menores al ancho real
// de `orig` (ver `buildVariants`): una imagen de 900px de ancho no produce un w1080 más
// pesado y peor que el propio orig.
export const VARIANT_WIDTHS = [480, 768, 1080, 1440, 1920] as const;

export type ImageProfileKey = "default" | "avatar";

// El perfil se deriva del hueco real donde se muestra la imagen, no del archivo de entrada.
// `avatar` es de un solo tamaño (círculo pequeño de reseñas): no tiene sentido generar una
// escalera de variantes para algo que nunca se ve a más de ~120px.
export const IMAGE_PROFILES: Record<ImageProfileKey, { maxDimension: number; widths: readonly number[] }> = {
  default: { maxDimension: 2400, widths: VARIANT_WIDTHS },
  avatar: { maxDimension: 480, widths: [] },
};

export class InvalidImageError extends Error {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidImageError";
  }
}

export type EncodedImage = {
  buffer: Buffer;
  width: number;
  height: number;
  format: "webp";
};

export type BuiltVariants = {
  width: number;
  height: number;
  orig: EncodedImage;
  variants: EncodedImage[];
};

// Cola de un solo carril: `sharp.concurrency(1)` limita los hilos de UN pipeline, pero dos
// subidas simultáneas desde el panel abrirían dos pipelines y duplicarían el pico de
// memoria. Encadenamos todas las llamadas para que se procesen una tras otra.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task) as Promise<T>;
  chain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function decodeMaster(buffer: Buffer, maxDimension: number) {
  try {
    const { data, info } = await sharp(buffer, INPUT_OPTIONS)
      .rotate()
      .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, raw: { width: info.width, height: info.height, channels: info.channels as 1 | 2 | 3 | 4 } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InvalidImageError(`Imagen inválida: el archivo no se pudo leer como imagen (${message})`);
  }
}

function fromMaster(master: Awaited<ReturnType<typeof decodeMaster>>) {
  return sharp(master.data, { raw: master.raw });
}

async function encodeWebp(pipeline: sharp.Sharp, quality: number, alphaQuality?: number): Promise<EncodedImage> {
  const { data, info } = await pipeline
    .webp({ quality, effort: 5, alphaQuality: alphaQuality ?? 80 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, format: "webp" };
}

/**
 * Decodifica una sola vez (rotando por EXIF y acotando el lado mayor), y desde ese master
 * codifica `orig.webp` más una escalera de variantes más chicas para `srcset`. Nunca agranda
 * una imagen (`withoutEnlargement`) ni genera una variante igual o más grande que `orig`.
 */
export async function buildVariants(buffer: Buffer, profile: ImageProfileKey = "default"): Promise<BuiltVariants> {
  const { maxDimension, widths } = IMAGE_PROFILES[profile];

  return enqueue(async () => {
    const master = await decodeMaster(buffer, maxDimension);
    const origEncoded = await encodeWebp(fromMaster(master), 80, 90);

    const variants: EncodedImage[] = [];
    for (const width of widths.filter((candidate) => candidate < origEncoded.width)) {
      // Secuencial a propósito: un `Promise.all` sobre la escalera tendría varios
      // codificadores vivos a la vez, cada uno con su buffer de salida, en un proceso que no
      // tiene esa memoria de sobra.
      variants.push(await encodeWebp(fromMaster(master).resize({ width }), 78));
    }

    return { width: origEncoded.width, height: origEncoded.height, orig: origEncoded, variants };
  });
}
