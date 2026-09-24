import { describe, it, expect } from "vitest";
import { assertBrowserPlayableVideo, detectVideoCodec, isHevcCodec, UnsupportedVideoCodecError } from "./videoCodec";

/** Caja ISO BMFF: tamaño (4) + tipo (4) + contenido. */
const box = (type: string, ...children: Buffer[]): Buffer => {
  const body = Buffer.concat(children);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
};

/** Pista con su `hdlr` (`vide`/`soun`) y una sola entrada `stsd` con el códec dado. */
const trak = (handler: "vide" | "soun", codec: string): Buffer => {
  const hdlr = Buffer.alloc(25);
  hdlr.write(handler, 8, "latin1");
  const stsdHeader = Buffer.alloc(8);
  stsdHeader.writeUInt32BE(1, 4);
  const stsd = box("stsd", stsdHeader, box(codec, Buffer.alloc(78)));
  return box("trak", box("tkhd", Buffer.alloc(84)), box("mdia", box("hdlr", hdlr), box("minf", box("stbl", stsd))));
};

const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isomavc1", "latin1"));
const mdat = box("mdat", Buffer.alloc(64, 0xaa));
const moov = (...traks: Buffer[]) => box("moov", box("mvhd", Buffer.alloc(100)), ...traks);

describe("detectVideoCodec", () => {
  it("lee el códec de la pista de vídeo de un MP4 con faststart (moov antes de mdat)", () => {
    expect(detectVideoCodec(Buffer.concat([ftyp, moov(trak("vide", "avc1")), mdat]))).toBe("avc1");
  });

  // Así venían los dos vídeos que se veían negros: HEVC con el moov al final del archivo.
  it("encuentra el moov aunque esté después de mdat", () => {
    expect(detectVideoCodec(Buffer.concat([ftyp, mdat, moov(trak("vide", "hvc1"))]))).toBe("hvc1");
  });

  it("salta la pista de audio y devuelve la de vídeo", () => {
    const file = Buffer.concat([ftyp, moov(trak("soun", "mp4a"), trak("vide", "hev1")), mdat]);
    expect(detectVideoCodec(file)).toBe("hev1");
  });

  it("soporta una caja mdat con tamaño de 64 bits", () => {
    const largeHeader = Buffer.alloc(16);
    largeHeader.writeUInt32BE(1, 0);
    largeHeader.write("mdat", 4, "latin1");
    largeHeader.writeBigUInt64BE(BigInt(16 + 32), 8);
    const largeMdat = Buffer.concat([largeHeader, Buffer.alloc(32)]);
    expect(detectVideoCodec(Buffer.concat([ftyp, largeMdat, moov(trak("vide", "hvc1"))]))).toBe("hvc1");
  });

  it("devuelve null (y no lanza) con lo que no es ISO BMFF, vacío o truncado", () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81]);
    const complete = Buffer.concat([ftyp, moov(trak("vide", "hvc1")), mdat]);
    expect(detectVideoCodec(webm)).toBeNull();
    expect(detectVideoCodec(Buffer.from("no-es-un-video-real"))).toBeNull();
    expect(detectVideoCodec(undefined)).toBeNull();
    expect(detectVideoCodec(complete.subarray(0, ftyp.length + 40))).toBeNull();
  });

  it("devuelve null si no hay pista de vídeo (solo audio)", () => {
    expect(detectVideoCodec(Buffer.concat([ftyp, moov(trak("soun", "mp4a")), mdat]))).toBeNull();
  });
});

describe("assertBrowserPlayableVideo", () => {
  it("rechaza HEVC, incluido Dolby Vision, nombrando el archivo", () => {
    for (const codec of ["hvc1", "hev1", "dvh1"]) {
      const file = Buffer.concat([ftyp, moov(trak("vide", codec)), mdat]);
      expect(() => assertBrowserPlayableVideo(file, "HT33.mp4")).toThrow(UnsupportedVideoCodecError);
    }
    const file = Buffer.concat([ftyp, moov(trak("vide", "hvc1")), mdat]);
    expect(() => assertBrowserPlayableVideo(file, "HT33.mp4")).toThrow(/HT33\.mp4/);
  });

  it("deja pasar H.264 y lo que no sabe leer", () => {
    expect(() => assertBrowserPlayableVideo(Buffer.concat([ftyp, moov(trak("vide", "avc1")), mdat]), "ok.mp4")).not.toThrow();
    expect(() => assertBrowserPlayableVideo(Buffer.from("no-es-un-video-real"), "raro.mp4")).not.toThrow();
  });

  it("isHevcCodec no marca otros códecs", () => {
    expect(isHevcCodec("avc1")).toBe(false);
    expect(isHevcCodec("av01")).toBe(false);
    expect(isHevcCodec(null)).toBe(false);
  });
});
