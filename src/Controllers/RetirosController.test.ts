import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
// Estos imports reciben las versiones simuladas de abajo: vitest sube los `vi.mock` por encima.
import { RetirosController } from "./RetirosController";
import { RetirosService } from "../services/retiros.service";
import { GcsStorageService } from "../services/csStorage.service";

/**
 * El encuadre de la foto de la card de un retiro (`encuadreImagen`): que se guarde en la escala del
 * archivo subido (el perfil `single` lo acota a 1600 px), que un encuadre ilegible corte antes de
 * subir nada, y que editar sin mandarlo no lo toque (de borrarlo si cambió la foto se encarga
 * `RetirosService.updateById`, probado abajo).
 */

vi.mock("../services/csStorage.service", () => ({
  GcsStorageService: {
    // La foto del celular (4032×3024) sale del perfil `single` acotada a 1600 px.
    uploadFile: vi.fn(async () => ({
      fileId: "fotosresort/nueva/orig.webp",
      storageKey: "fotosresort/nueva/orig.webp",
      url: "https://storage.example.com/fotosresort/nueva/orig.webp",
      width: 1600,
      height: 1200,
      variants: [],
    })),
    deleteFile: vi.fn(async () => ({ success: true })),
  },
}));

vi.mock("../services/retiros.service", () => ({
  RetirosService: {
    create: vi.fn(async (data: unknown) => data),
    updateById: vi.fn(async (_id: string, data: unknown) => data),
  },
}));

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

const archivo = { originalname: "yoga.jpg", mimetype: "image/jpeg", buffer: Buffer.from("x") } as Express.Multer.File;
const URL_GUARDADA = "https://storage.example.com/fotosresort/vieja/orig.webp";
const ENCUADRE_CELULAR = JSON.stringify({
  desktop_coordinates: "1000,500,2000,1500",
  mobile_coordinates: "0,0,2268,3024",
  source_width: 4032,
  source_height: 3024,
});

const req = (body: Record<string, unknown>, files: Express.Multer.File[] = []) =>
  ({ params: { id: "68377eb74a64a493f851b34d" }, body, files }) as unknown as Request;

const guardado = (fn: "create" | "updateById") => {
  const calls = vi.mocked(RetirosService[fn]).mock.calls;
  const last = calls[calls.length - 1];
  return (fn === "create" ? last?.[0] : last?.[1]) as Record<string, unknown> | undefined;
};

beforeEach(() => vi.clearAllMocks());

describe("POST /retiros — encuadreImagen", () => {
  it("con foto subida, guarda el encuadre en la escala del archivo acotado", async () => {
    const res = makeRes();
    await RetirosController.create(req({ encuadreImagen: ENCUADRE_CELULAR }, [archivo]), res);

    expect(res.statusCode).toBe(201);
    expect(guardado("create")?.encuadreImagen).toEqual({
      desktop_coordinates: "397,198,794,595",
      mobile_coordinates: "0,0,900,1200",
    });
  });

  it("sin encuadre, el retiro nace con la foto centrada", async () => {
    const res = makeRes();
    await RetirosController.create(req({}, [archivo]), res);

    expect(res.statusCode).toBe(201);
    expect(guardado("create")?.encuadreImagen).toBeNull();
  });

  it("un encuadre ilegible es un 400 y no llega a subir la foto", async () => {
    const res = makeRes();
    await RetirosController.create(req({ encuadreImagen: "{roto" }, [archivo]), res);

    expect(res.statusCode).toBe(400);
    expect(GcsStorageService.uploadFile).not.toHaveBeenCalled();
    expect(RetirosService.create).not.toHaveBeenCalled();
  });
});

describe("PUT /retiros/:id — encuadreImagen", () => {
  it("con la misma foto (URL), guarda el encuadre tal como lo midió el panel", async () => {
    const res = makeRes();
    await RetirosController.updateById(
      req({
        imagen: URL_GUARDADA,
        encuadreImagen: JSON.stringify({
          desktop_coordinates: "100,0,1164,960",
          mobile_coordinates: "140,0,1119,960",
          source_width: 1600,
          source_height: 960,
        }),
      }),
      res
    );

    expect(res.statusCode).toBe(200);
    expect(guardado("updateById")?.encuadreImagen).toEqual({
      desktop_coordinates: "100,0,1164,960",
      mobile_coordinates: "140,0,1119,960",
    });
    expect(GcsStorageService.uploadFile).not.toHaveBeenCalled();
  });

  it("con foto nueva, reescala el encuadre al archivo subido", async () => {
    const res = makeRes();
    await RetirosController.updateById(req({ encuadreImagen: ENCUADRE_CELULAR }, [archivo]), res);

    expect(guardado("updateById")?.encuadreImagen).toEqual({
      desktop_coordinates: "397,198,794,595",
      mobile_coordinates: "0,0,900,1200",
    });
  });

  it("sin el campo, no lo manda al servicio (el servicio decide si la foto cambió)", async () => {
    const res = makeRes();
    await RetirosController.updateById(req({ nombre: "Volver a ti", imagen: URL_GUARDADA }), res);

    expect(res.statusCode).toBe(200);
    expect(guardado("updateById")).not.toHaveProperty("encuadreImagen");
  });

  it('"null" lo borra', async () => {
    const res = makeRes();
    await RetirosController.updateById(req({ imagen: URL_GUARDADA, encuadreImagen: "null" }), res);

    expect(guardado("updateById")?.encuadreImagen).toBeNull();
  });

  it("un encuadre ilegible es un 400 y no llega a subir la foto", async () => {
    const res = makeRes();
    await RetirosController.updateById(
      req({ encuadreImagen: JSON.stringify({ desktop_coordinates: "0,0,10,10" }) }, [archivo]),
      res
    );

    expect(res.statusCode).toBe(400);
    expect(GcsStorageService.uploadFile).not.toHaveBeenCalled();
    expect(RetirosService.updateById).not.toHaveBeenCalled();
  });
});
