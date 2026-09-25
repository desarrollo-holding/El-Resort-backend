/**
 * Rechaza, al subirlos, los vídeos en HEVC (H.265).
 *
 * POR QUÉ
 * El vídeo se guarda tal cual lo sube el admin (no se recodifica), y el iPhone graba en HEVC por
 * defecto. Chrome en Windows solo decodifica HEVC si la tarjeta gráfica lo soporta: en los equipos
 * que no, el `<video>` reproduce el audio y deja la imagen en negro (o en el póster), sin error
 * visible. Como en el equipo de quien lo subió sí se ve, el fallo parece aleatorio. Pasó con los
 * vídeos de escritorio de Cabañas Old Yanashpa y Casa Village 33 (septiembre 2026).
 *
 * CÓMO
 * MP4, MOV, M4V y 3GP comparten el formato de cajas ISO BMFF: el códec de cada pista está en la
 * primera entrada de `moov/trak/mdia/minf/stbl/stsd` (un código de 4 letras: `avc1` es H.264,
 * `hvc1`/`hev1` es HEVC). Basta leer esas cajas del buffer que ya tiene multer en memoria; no hace
 * falta ffmpeg. `moov` puede ir antes o después de `mdat`, así que se recorre el archivo entero.
 *
 * Si el archivo no es ISO BMFF (WebM, AVI…) o no se puede leer, NO se bloquea: este control existe
 * para rechazar un caso concreto y comprobado, no para adivinar sobre formatos que no entiende.
 */

/** Entradas `stsd` de vídeo HEVC. `dvh1`/`dvhe` son Dolby Vision sobre HEVC (vídeo HDR del iPhone). */
const HEVC_SAMPLE_ENTRIES = new Set(["hvc1", "hev1", "hvc2", "hev2", "dvh1", "dvhe"]);

type Box = { type: string; body: number; end: number };

/** Cajas hijas de [start, end). Devuelve lo leído hasta la primera caja mal formada. */
const readBoxes = (buf: Buffer, start: number, end: number): Box[] => {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    boxes.push({ type, body: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
};

const findChild = (buf: Buffer, parent: Box | undefined, type: string): Box | undefined =>
  parent ? readBoxes(buf, parent.body, parent.end).find((box) => box.type === type) : undefined;

/**
 * Código de 4 letras del códec de la primera pista de vídeo (`avc1`, `hvc1`, `av01`…), o `null`
 * si el buffer no es ISO BMFF, no tiene pista de vídeo o está truncado.
 */
export const detectVideoCodec = (buf: Buffer | undefined): string | null => {
  if (!buf || buf.length < 16) return null;
  try {
    const moov = readBoxes(buf, 0, buf.length).find((box) => box.type === "moov");
    if (!moov) return null;

    for (const trak of readBoxes(buf, moov.body, moov.end).filter((box) => box.type === "trak")) {
      const mdia = findChild(buf, trak, "mdia");
      const hdlr = findChild(buf, mdia, "hdlr");
      // hdlr: version/flags (4) + pre_defined (4) + handler_type (4)
      if (!hdlr || hdlr.body + 12 > hdlr.end) continue;
      if (buf.toString("latin1", hdlr.body + 8, hdlr.body + 12) !== "vide") continue;

      const stsd = findChild(buf, findChild(buf, findChild(buf, mdia, "minf"), "stbl"), "stsd");
      if (!stsd) return null;
      // stsd: version/flags (4) + entry_count (4), y después las entradas como cajas.
      const [entry] = readBoxes(buf, stsd.body + 8, stsd.end);
      return entry ? entry.type : null;
    }
    return null;
  } catch {
    return null;
  }
};

export const isHevcCodec = (codec: string | null): boolean => codec !== null && HEVC_SAMPLE_ENTRIES.has(codec);

/** Lo traduce `describeError` a un 415 con la pista de cómo reexportar el vídeo. */
export class UnsupportedVideoCodecError extends Error {
  constructor(
    readonly fileName: string,
    readonly codec: string
  ) {
    super(`Vídeo en HEVC (${codec}): ${fileName}`);
    this.name = "UnsupportedVideoCodecError";
  }
}

export const assertBrowserPlayableVideo = (buf: Buffer | undefined, fileName: string): void => {
  const codec = detectVideoCodec(buf);
  if (isHevcCodec(codec)) throw new UnsupportedVideoCodecError(fileName, codec as string);
};
