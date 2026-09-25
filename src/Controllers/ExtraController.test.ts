import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
// Estos imports reciben las versiones simuladas de abajo: vitest sube los `vi.mock` por encima.
import { ExtraController } from "./ExtraController";
import { uploadImageAsset } from "../services/imageAssetUpload";

/**
 * El encuadre de la foto de una actividad personalizada (`encuadreImagen`): que se guarde en la
 * escala del archivo subido, que el texto JSON del multipart no llegue crudo a Mongoose (el alta y la
 * edición pasan el body entero al modelo), que cambiar la foto sin encuadre nuevo lo borre, y que uno
 * ilegible corte antes de subir nada.
 */

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

vi.mock("../services/extras.service", () => ({ ExtrasService: {} }));

const FOTO_GUARDADA = {
  url: "https://storage.example.com/fotosresort/vieja/orig.webp",
  storageKey: "fotosresort/vieja/orig.webp",
  storagePrefix: "fotosresort/vieja",
  width: 1600,
  height: 1200,
  variants: [],
};

const creados: Array<Record<string, unknown>> = [];
const actualizaciones: Array<Record<string, unknown>> = [];

vi.mock("../models/Extras", () => {
  class FakeExtra {
    constructor(data: Record<string, unknown>) {
      creados.push(data);
    }
    save = vi.fn(async () => undefined);
    static findById = vi.fn(async () => ({
      nombre: "Masaje",
      descripcion: "",
      imagenes: [FOTO_GUARDADA],
      encuadreImagen: { desktop_coordinates: "0,0,1600,1200", mobile_coordinates: "0,0,1600,1200" },
    }));
    static findByIdAndUpdate = vi.fn(async (_id: string, payload: Record<string, unknown>) => {
      actualizaciones.push(payload);
      return { ...payload, imagenes: payload.imagenes ?? [FOTO_GUARDADA] };
    });
  }
  return { default: FakeExtra };
});

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
  res.send = vi.fn((body: unknown) => {
    res.body = body;
    return res;
  }) as unknown as FakeRes["send"];
  return res;
}

const archivo = { originalname: "masaje.jpg", mimetype: "image/jpeg", buffer: Buffer.from("x") } as Express.Multer.File;
const ENCUADRE_CELULAR = JSON.stringify({
  desktop_coordinates: "1000,500,2000,1500",
  mobile_coordinates: "0,0,2268,3024",
  source_width: 4032,
  source_height: 3024,
});
const req = (body: Record<string, unknown>, files: Express.Multer.File[] = []) =>
  ({ params: { id: "64a6c0f1f6a2c8e7e0c0a222" }, body: { nombre: "Masaje", precio: "120", ...body }, files }) as unknown as Request;

beforeEach(() => {
  vi.clearAllMocks();
  creados.length = 0;
  actualizaciones.length = 0;
});

describe("POST /extras — encuadreImagen", () => {
  it("guarda el encuadre en la escala del archivo acotado, como objeto y no como el texto del multipart", async () => {
    const res = makeRes();
    await ExtraController.createExtra(req({ encuadreImagen: ENCUADRE_CELULAR }, [archivo]), res);

    expect(res.statusCode).toBe(200);
    expect(creados[0]?.encuadreImagen).toEqual({
      desktop_coordinates: "595,298,1190,893",
      mobile_coordinates: "0,0,1350,1800",
    });
  });

  it("sin encuadre, la actividad nace con la foto centrada", async () => {
    const res = makeRes();
    await ExtraController.createExtra(req({}, [archivo]), res);

    expect(creados[0]?.encuadreImagen).toBeNull();
  });

  it("un encuadre ilegible es un 400 y no llega a subir la foto", async () => {
    const res = makeRes();
    await ExtraController.createExtra(req({ encuadreImagen: "{roto" }, [archivo]), res);

    expect(res.statusCode).toBe(400);
    expect(uploadImageAsset).not.toHaveBeenCalled();
    expect(creados).toHaveLength(0);
  });
});

describe("PUT /extras/:id — encuadreImagen", () => {
  it("con la misma foto, guarda el encuadre que manda el panel (como objeto)", async () => {
    const res = makeRes();
    await ExtraController.updateExtra(
      req({
        imagenes: FOTO_GUARDADA.url,
        encuadreImagen: JSON.stringify({
          desktop_coordinates: "100,0,1398,1200",
          mobile_coordinates: "100,0,1398,1200",
          source_width: 1600,
          source_height: 1200,
        }),
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(actualizaciones[0]?.encuadreImagen).toEqual({
      desktop_coordinates: "100,0,1398,1200",
      mobile_coordinates: "100,0,1398,1200",
    });
  });

  it("foto nueva sin encuadre: borra el de la foto anterior", async () => {
    const res = makeRes();
    await ExtraController.updateExtra(req({}, [archivo]), res);

    expect(actualizaciones[0]?.encuadreImagen).toBeNull();
  });

  it("editar el nombre con la misma foto no toca el encuadre", async () => {
    const res = makeRes();
    await ExtraController.updateExtra(req({ nombre: "Masaje de piedras", imagenes: FOTO_GUARDADA.url }), res);

    expect(actualizaciones[0]).not.toHaveProperty("encuadreImagen");
  });

  it("un encuadre ilegible es un 400 y no llega a subir la foto", async () => {
    const res = makeRes();
    await ExtraController.updateExtra(req({ encuadreImagen: JSON.stringify({ desktop_coordinates: "0,0,10" }) }, [archivo]), res);

    expect(res.statusCode).toBe(400);
    expect(uploadImageAsset).not.toHaveBeenCalled();
    expect(actualizaciones).toHaveLength(0);
  });
});
