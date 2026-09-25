import { describe, it, expect, vi, beforeEach } from "vitest";
// Recibe la versión simulada de abajo: vitest sube los `vi.mock` por encima.
import { RetirosService } from "./retiros.service";

/**
 * Un encuadre es de una foto concreta: al cambiar la foto de un retiro sin mandar un encuadre
 * nuevo, el anterior se borra (apuntaría a cualquier parte de la foto nueva).
 */

const URL_GUARDADA = "https://storage.example.com/fotosresort/vieja/orig.webp";
const URL_NUEVA = "https://storage.example.com/fotosresort/nueva/orig.webp";
const ENCUADRE = { desktop_coordinates: "0,0,1164,960", mobile_coordinates: "140,0,1119,960" };

const findByIdAndUpdate = vi.fn(async (_id: string, patch: unknown) => patch);

vi.mock("../models/Retiros", () => ({
  default: {
    findById: vi.fn(async () => ({
      nombre: "Volver a ti",
      descripcion: "x",
      idealPara: "Un descanso real.",
      imagen: URL_GUARDADA,
      encuadreImagen: ENCUADRE,
    })),
    findByIdAndUpdate: (id: string, patch: unknown) => findByIdAndUpdate(id, patch),
  },
}));

vi.mock("./translate.service", () => ({ TranslateService: {} }));

const patchEnviado = () => findByIdAndUpdate.mock.calls[0]?.[1] as Record<string, unknown>;

beforeEach(() => findByIdAndUpdate.mockClear());

describe("RetirosService.updateById — encuadreImagen", () => {
  it("foto nueva sin encuadre: borra el de la foto anterior", async () => {
    await RetirosService.updateById("id", { imagen: URL_NUEVA });
    expect(patchEnviado().encuadreImagen).toBeNull();
  });

  it("foto nueva con encuadre: guarda el nuevo", async () => {
    const nuevo = { desktop_coordinates: "10,0,100,80", mobile_coordinates: "20,0,90,80" };
    await RetirosService.updateById("id", { imagen: URL_NUEVA, encuadreImagen: nuevo });
    expect(patchEnviado().encuadreImagen).toEqual(nuevo);
  });

  it("misma foto sin encuadre: no lo toca", async () => {
    await RetirosService.updateById("id", { imagen: URL_GUARDADA, nombre: "Volver a ti" });
    expect(patchEnviado()).not.toHaveProperty("encuadreImagen");
  });
});
