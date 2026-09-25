import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
// Estos imports reciben las versiones simuladas de abajo: vitest sube los `vi.mock` por encima.
import { AreaController } from "./AreaController";
import { uploadImageAsset } from "../services/imageAssetUpload";
import { GcsStorageService } from "../services/csStorage.service";

/**
 * Cobertura del encuadre de la foto de un área (`encuadreImagen`): que se guarde en la escala del
 * archivo que queda en el bucket, que se borre cuando cambia la foto sin encuadre nuevo, que se
 * pueda cambiar solo el encuadre, y que uno ilegible corte antes de subir nada.
 */

vi.mock("mongoose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongoose")>();
  return { ...actual, default: { ...actual.default, connection: { readyState: 1 } } };
});

vi.mock("../services/imageAssetUpload", () => ({
  // La foto del celular (4032×3024) sale del pipeline acotada a 2400 px.
  uploadImageAsset: vi.fn(async () => ({
    url: "https://storage.example.com/fotosresort/nueva/orig.webp",
    storageKey: "fotosresort/nueva/orig.webp",
    storagePrefix: "fotosresort/nueva",
    width: 2400,
    height: 1800,
    variants: [],
  })),
}));

vi.mock("../services/csStorage.service", () => ({
  GcsStorageService: {
    deleteFile: vi.fn(async () => ({ success: true })),
    extractKeyFromUrl: vi.fn(() => null),
  },
}));

vi.mock("../services/translate.service", () => ({
  TranslateService: { backfillEnglishField: vi.fn(), buildSetOps: vi.fn(() => []) },
}));

type FakeArea = {
  nombre: string;
  descripcion: string;
  imagenes: unknown[];
  encuadreImagen: unknown;
  save: ReturnType<typeof vi.fn>;
};

let stored: FakeArea;
const created: Array<Record<string, unknown>> = [];

vi.mock("../models/Area", () => {
  class FakeAreaModel {
    constructor(data: Record<string, unknown>) {
      Object.assign(this, data);
      created.push(data);
    }
    save = vi.fn(async () => undefined);
    static findById = vi.fn(async () => stored);
  }
  return { default: FakeAreaModel, AREA_CATEGORIAS: ["AREAS", "ACTIVIDADES_GRUPALES"] };
});


const FOTO_GUARDADA = {
  url: "https://storage.example.com/fotosresort/vieja/orig.webp",
  storageKey: "fotosresort/vieja/orig.webp",
  storagePrefix: "fotosresort/vieja",
  width: 1600,
  height: 1200,
  variants: [],
};
const ENCUADRE_GUARDADO = { desktop_coordinates: "0,0,1600,1200", mobile_coordinates: "400,0,900,1200" };

const archivo = { originalname: "grupo.jpg", mimetype: "image/jpeg", buffer: Buffer.from("x") } as Express.Multer.File;

type FakeRes = Response & { statusCode: number; body: unknown };

function makeRes(): FakeRes {
  const res = { statusCode: 200, body: undefined } as unknown as FakeRes;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as unknown as FakeRes["status"];
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as FakeRes["json"];
  return res;
}

const patch = (body: Record<string, unknown>, files: Express.Multer.File[] = []) =>
  ({ params: { id: "64a6c0f1f6a2c8e7e0c0a333" }, body, files }) as unknown as Request;

beforeEach(() => {
  vi.clearAllMocks();
  created.length = 0;
  stored = {
    nombre: "Fogata",
    descripcion: "",
    imagenes: [FOTO_GUARDADA],
    encuadreImagen: { ...ENCUADRE_GUARDADO },
    save: vi.fn(async () => undefined),
  };
});

describe("PATCH /areas/:id — encuadreImagen", () => {
  it("foto nueva con encuadre: lo guarda en la escala del archivo acotado, no en la del celular", async () => {
    const res = makeRes();
    await AreaController.patchAreaById(
      patch(
        {
          encuadreImagen: JSON.stringify({
            desktop_coordinates: "1000,500,2000,1500",
            mobile_coordinates: "0,0,2268,3024",
            source_width: 4032,
            source_height: 3024,
          }),
        },
        [archivo]
      ),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(stored.encuadreImagen).toEqual({
      desktop_coordinates: "595,298,1190,893",
      mobile_coordinates: "0,0,1350,1800",
    });
    expect(stored.save).toHaveBeenCalledOnce();
  });

  it("foto nueva sin encuadre: borra el de la foto anterior", async () => {
    const res = makeRes();
    await AreaController.patchAreaById(patch({}, [archivo]), res);

    expect(res.statusCode).toBe(200);
    expect(stored.encuadreImagen).toBeNull();
  });

  it("solo el encuadre: lo cambia sin tocar la foto ni borrar nada del bucket", async () => {
    const res = makeRes();
    await AreaController.patchAreaById(
      patch({
        imagenes: FOTO_GUARDADA.url,
        encuadreImagen: JSON.stringify({
          desktop_coordinates: "100,0,1400,1200",
          mobile_coordinates: "500,0,900,1200",
          source_width: 1600,
          source_height: 1200,
        }),
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(stored.imagenes).toEqual([FOTO_GUARDADA]);
    expect(stored.encuadreImagen).toEqual({
      desktop_coordinates: "100,0,1400,1200",
      mobile_coordinates: "500,0,900,1200",
    });
    expect(uploadImageAsset).not.toHaveBeenCalled();
    expect(GcsStorageService.deleteFile).not.toHaveBeenCalled();
  });

  it("un encuadre sin otros cambios alcanza para que la petición sea válida", async () => {
    const res = makeRes();
    await AreaController.patchAreaById(patch({ encuadreImagen: "null" }), res);

    expect(res.statusCode).toBe(200);
    expect(stored.encuadreImagen).toBeNull();
  });

  it("editar el nombre con la misma foto conserva el encuadre", async () => {
    const res = makeRes();
    await AreaController.patchAreaById(patch({ nombre: "Fogata nocturna", imagenes: FOTO_GUARDADA.url }), res);

    expect(res.statusCode).toBe(200);
    expect(stored.encuadreImagen).toEqual(ENCUADRE_GUARDADO);
  });

  it("un encuadre ilegible es un 400 y no llega a subir la foto", async () => {
    const res = makeRes();
    await AreaController.patchAreaById(
      patch({ encuadreImagen: JSON.stringify({ desktop_coordinates: "0,0,10" }) }, [archivo]),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(uploadImageAsset).not.toHaveBeenCalled();
    expect(stored.save).not.toHaveBeenCalled();
  });
});

describe("POST /areas — encuadreImagen", () => {
  const post = (body: Record<string, unknown>, files: Express.Multer.File[] = []) =>
    ({ body: { nombre: "Fogata", categoria: "ACTIVIDADES_GRUPALES", ...body }, files }) as unknown as Request;

  it("crea el área con el encuadre reescalado al archivo guardado", async () => {
    const res = makeRes();
    await AreaController.createArea(
      post(
        {
          encuadreImagen: JSON.stringify({
            desktop_coordinates: "1000,500,2000,1500",
            mobile_coordinates: "0,0,2268,3024",
            source_width: 4032,
            source_height: 3024,
          }),
        },
        [archivo]
      ),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(created[0]?.encuadreImagen).toEqual({
      desktop_coordinates: "595,298,1190,893",
      mobile_coordinates: "0,0,1350,1800",
    });
  });

  it("sin foto no guarda encuadre aunque venga uno", async () => {
    const res = makeRes();
    await AreaController.createArea(
      post({ encuadreImagen: { desktop_coordinates: "0,0,10,10", mobile_coordinates: "0,0,10,10" } }),
      res
    );

    expect(res.statusCode).toBe(201);
    expect(created[0]?.encuadreImagen).toBeNull();
  });

  it("un encuadre ilegible es un 400 y no llega a subir la foto", async () => {
    const res = makeRes();
    await AreaController.createArea(post({ encuadreImagen: "{roto" }, [archivo]), res);

    expect(res.statusCode).toBe(400);
    expect(uploadImageAsset).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});

describe("DELETE /areas/:id/imagenes", () => {
  it("quitar la foto borra también su encuadre", async () => {
    const res = makeRes();
    await AreaController.deleteAreaImagesById(
      { params: { id: "64a6c0f1f6a2c8e7e0c0a333" }, body: { imagen: FOTO_GUARDADA.url } } as unknown as Request,
      res
    );

    expect(res.statusCode).toBe(200);
    expect(stored.imagenes).toEqual([]);
    expect(stored.encuadreImagen).toBeNull();
  });
});
