import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Cobertura del PUT en lo que toca a los DOS vídeos (escritorio y móvil): que cada slot viaje por
 * su propio campo, que subir uno no pise al otro, y que el archivo nuevo gane sobre la URL previa.
 * Es el punto donde antes se mezclaban, porque `video_url` era el único campo.
 */

const uploadedFiles: Array<{ originalName: string; mimeType: string; mediaKind: string }> = [];
let uploadCounter = 0;

vi.mock("../../services/csStorage.service", () => ({
  GcsStorageService: {
    uploadFile: vi.fn(async ({ originalName, mimeType, mediaKind }: any) => {
      uploadedFiles.push({ originalName, mimeType, mediaKind });
      uploadCounter += 1;
      return {
        fileId: `videos/${uploadCounter}_${originalName}`,
        url: `https://storage.example.com/videos/${uploadCounter}_${originalName}`,
        variants: [],
      };
    }),
    deleteFile: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock("../../services/imageAssetUpload", () => ({
  uploadImageAsset: vi.fn(async () => ({
    url: "https://storage.example.com/img/orig.webp",
    storageKey: "fotosresort/img/orig.webp",
    storagePrefix: "fotosresort/img",
    variants: [],
  })),
}));

vi.mock("../../services/condominios.service", () => ({
  CondominiosService: { getMapUrlById: vi.fn(async () => null) },
}));
vi.mock("../../services/beneficios.service", () => ({
  BeneficiosService: { resolveForRoomType: vi.fn(async () => []) },
}));
vi.mock("../../services/roomTypeTranslation.service", () => ({
  RoomTypeTranslationService: { translateRoomTypeSpecsPayloadToEnglish: vi.fn(async (p: unknown) => p) },
}));
vi.mock("../../services/roomTypeLocalText.service", () => ({
  RoomTypeLocalTextService: { resolveEnglishText: vi.fn(async () => null) },
}));
vi.mock("./cloudbedsEnrichment", () => ({
  fetchCloudbedsRoomTypesMapSafe: vi.fn(async () => new Map()),
  fetchCloudbedsRatesMapSafe: vi.fn(async () => new Map()),
}));

/** Documento que "ya existe" en Mongo; cada test lo ajusta antes de llamar al controlador. */
let existingDoc: Record<string, unknown> = {};
/** Último `update` que el controlador mandó a `findOneAndUpdate`: el objeto que se asserta. */
let capturedUpdate: Record<string, unknown> | null = null;

vi.mock("../../models/RoomTypeLocalSpecs", () => ({
  default: {
    findOne: vi.fn(() => ({ lean: async () => existingDoc })),
    findOneAndUpdate: vi.fn((_filter: unknown, update: Record<string, unknown>) => {
      capturedUpdate = update;
      return { lean: async () => ({ ...existingDoc, ...update }) };
    }),
  },
}));

import mongoose from "mongoose";
import { updateByRoomTypeID } from "./crud";

// `readyState` es un getter: el controlador aborta con 503 si no es 1, y no queremos una conexión real.
Object.defineProperty(mongoose.connection, "readyState", { get: () => 1, configurable: true });

const videoFile = (fieldname: string, originalname: string, mimetype = "video/mp4"): Express.Multer.File =>
  ({ fieldname, originalname, mimetype, buffer: Buffer.from("x") } as Express.Multer.File);

type CallResult = { status: number; body: any };

async function callUpdate(
  payload: Record<string, unknown>,
  files: Express.Multer.File[] = []
): Promise<CallResult> {
  const result: CallResult = { status: 200, body: null };
  const req = {
    params: { roomTypeID: "bungalow-1" },
    body: { payload: JSON.stringify(payload) },
    files,
  } as unknown as Request;

  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  } as unknown as Response;

  await updateByRoomTypeID(req, res);
  return result;
}

beforeEach(() => {
  uploadedFiles.length = 0;
  uploadCounter = 0;
  capturedUpdate = null;
  existingDoc = {
    roomTypeID: "bungalow-1",
    bathroomsCount: 1,
    bedrooms: [],
    extraGalleryImages: [],
    video_url: [],
    video_url_mobile: [],
    beneficios: [],
  };
  vi.clearAllMocks();
});

describe("updateByRoomTypeID · vídeos de escritorio y móvil", () => {
  it("sube los dos vídeos a la vez y los guarda en campos distintos", async () => {
    const res = await callUpdate({ video_url: [], video_url_mobile: [] }, [
      videoFile("videoFiles", "escritorio.mp4"),
      videoFile("videoMobileFiles", "movil.mp4"),
    ]);

    expect(res.status).toBe(200);
    expect(uploadedFiles).toHaveLength(2);
    expect(uploadedFiles.every((f) => f.mediaKind === "video")).toBe(true);

    expect(capturedUpdate?.video_url).toEqual(["https://storage.example.com/videos/1_escritorio.mp4"]);
    expect(capturedUpdate?.video_url_mobile).toEqual(["https://storage.example.com/videos/2_movil.mp4"]);
  });

  it("subir solo el de móvil no toca el de escritorio ya guardado", async () => {
    existingDoc.video_url = ["https://storage.example.com/videos/viejo-escritorio.mp4"];

    await callUpdate(
      {
        video_url: ["https://storage.example.com/videos/viejo-escritorio.mp4"],
        video_url_mobile: [],
      },
      [videoFile("videoMobileFiles", "movil.mp4")]
    );

    expect(capturedUpdate?.video_url).toEqual(["https://storage.example.com/videos/viejo-escritorio.mp4"]);
    expect(capturedUpdate?.video_url_mobile).toEqual(["https://storage.example.com/videos/1_movil.mp4"]);
  });

  it("subir solo el de escritorio no toca el de móvil ya guardado", async () => {
    existingDoc.video_url_mobile = ["https://storage.example.com/videos/viejo-movil.mp4"];

    await callUpdate(
      {
        video_url: [],
        video_url_mobile: ["https://storage.example.com/videos/viejo-movil.mp4"],
      },
      [videoFile("videoFiles", "escritorio.mp4")]
    );

    expect(capturedUpdate?.video_url).toEqual(["https://storage.example.com/videos/1_escritorio.mp4"]);
    expect(capturedUpdate?.video_url_mobile).toEqual(["https://storage.example.com/videos/viejo-movil.mp4"]);
  });

  it("un array vacío borra el vídeo de móvil sin borrar el de escritorio", async () => {
    existingDoc.video_url = ["https://storage.example.com/videos/escritorio.mp4"];
    existingDoc.video_url_mobile = ["https://storage.example.com/videos/movil.mp4"];

    await callUpdate({
      video_url: ["https://storage.example.com/videos/escritorio.mp4"],
      video_url_mobile: [],
    });

    expect(capturedUpdate?.video_url).toEqual(["https://storage.example.com/videos/escritorio.mp4"]);
    expect(capturedUpdate?.video_url_mobile).toEqual([]);
  });

  it("acepta un vídeo que llega como octet-stream (Windows) por su extensión", async () => {
    const res = await callUpdate({ video_url_mobile: [] }, [
      videoFile("videoMobileFiles", "tour.webm", "application/octet-stream"),
    ]);

    expect(res.status).toBe(200);
    expect(capturedUpdate?.video_url_mobile).toEqual(["https://storage.example.com/videos/1_tour.webm"]);
  });

  it("rechaza en videoMobileFiles un archivo que no es vídeo", async () => {
    const res = await callUpdate({ video_url_mobile: [] }, [
      videoFile("videoMobileFiles", "folleto.pdf", "application/pdf"),
    ]);

    expect(res.status).toBe(400);
    expect(String(res.body?.error)).toContain("videoMobileFiles");
    expect(capturedUpdate).toBeNull();
  });

  it("no toca ningún campo de vídeo si el payload no los menciona", async () => {
    await callUpdate({ bathroomsCount: 3 });

    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate).not.toHaveProperty("video_url");
    expect(capturedUpdate).not.toHaveProperty("video_url_mobile");
  });
});
