import { describe, it, expect, vi } from "vitest";
// Recibe la versión simulada de abajo: vitest sube los `vi.mock` por encima.
import { ExtrasService } from "./extras.service";

/**
 * El listado agrupado arma cada actividad campo por campo (es lo que lee la tarjeta de la web): el
 * encuadre tiene que viajar ahí, o la web nunca lo vería.
 */

vi.mock("../models/Extras", () => ({
  default: {
    find: () => ({
      sort: () => ({
        lean: async () => [
          {
            nombre: "Masaje",
            precio: 120,
            descripcion: "",
            grupo: "Wellness",
            imagenes: [{ url: "https://storage.example.com/a/orig.webp", storageKey: "", storagePrefix: "", variants: [] }],
            encuadreImagen: { desktop_coordinates: "10,0,375,322", mobile_coordinates: "10,0,375,322" },
          },
          {
            nombre: "Cerámica",
            precio: 80,
            descripcion: "",
            grupo: "Talleres",
            imagenes: [],
          },
        ],
      }),
    }),
  },
}));

vi.mock("./translate.service", () => ({ TranslateService: {} }));

describe("ExtrasService.getExtrasGroupedByGrupo — encuadreImagen", () => {
  it("incluye el encuadre de cada actividad, y null si no tiene", async () => {
    const bloques = await ExtrasService.getExtrasGroupedByGrupo("es");
    const porNombre = Object.fromEntries(bloques.flatMap((b) => b.extras).map((e) => [e.nombre, e]));

    expect(porNombre["Masaje"]?.encuadreImagen).toEqual({
      desktop_coordinates: "10,0,375,322",
      mobile_coordinates: "10,0,375,322",
    });
    expect(porNombre["Cerámica"]?.encuadreImagen).toBeNull();
  });
});
