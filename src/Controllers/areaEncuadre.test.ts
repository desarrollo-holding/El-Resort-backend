import { describe, it, expect, vi } from "vitest";
import { encuadreParaImagen, parseEncuadreEntrada } from "./areaEncuadre";
import type { ImageAssetType } from "../models/shared/imageAsset";

const foto = (width?: number, height?: number): ImageAssetType => ({
  url: "https://storage.example.com/fotosresort/a/orig.webp",
  storageKey: "fotosresort/a/orig.webp",
  storagePrefix: "fotosresort/a",
  width,
  height,
  variants: [],
});

describe("parseEncuadreEntrada", () => {
  it("sin el campo no pide cambios", () => {
    expect(parseEncuadreEntrada(undefined)).toEqual({ tipo: "ausente" });
  });

  it.each([null, "", "   ", "null"])("%j borra el encuadre", (raw) => {
    expect(parseEncuadreEntrada(raw)).toEqual({ tipo: "borrar" });
  });

  it("acepta el objeto tal cual (body JSON) y normaliza los espacios", () => {
    expect(
      parseEncuadreEntrada({ desktop_coordinates: "10, 20, 300, 400", mobile_coordinates: "0,0,200,200" })
    ).toEqual({
      tipo: "fijar",
      encuadre: { desktop_coordinates: "10,20,300,400", mobile_coordinates: "0,0,200,200" },
      origen: null,
    });
  });

  it("acepta el texto JSON que llega por multipart, con el tamaño de origen", () => {
    const raw = JSON.stringify({
      desktop_coordinates: "1,2,3,4",
      mobile_coordinates: "5,6,7,8",
      source_width: 4032,
      source_height: 3024,
    });
    expect(parseEncuadreEntrada(raw)).toEqual({
      tipo: "fijar",
      encuadre: { desktop_coordinates: "1,2,3,4", mobile_coordinates: "5,6,7,8" },
      origen: { width: 4032, height: 3024 },
    });
  });

  it.each([
    ["sin coordenadas de móvil", { desktop_coordinates: "0,0,10,10" }],
    ["con tres números", { desktop_coordinates: "0,0,10", mobile_coordinates: "0,0,10,10" }],
    ["con ancho cero", { desktop_coordinates: "0,0,0,10", mobile_coordinates: "0,0,10,10" }],
    ["con texto", { desktop_coordinates: "a,b,c,d", mobile_coordinates: "0,0,10,10" }],
    ["un array", [1, 2, 3, 4]],
    ["un número", 42],
  ])("rechaza un encuadre %s", (_caso, raw) => {
    expect(parseEncuadreEntrada(raw).tipo).toBe("invalido");
  });

  it("rechaza un texto que no es JSON", () => {
    expect(parseEncuadreEntrada("0,0,10,10").tipo).toBe("invalido");
  });

  it("rechaza un tamaño de origen que no es positivo", () => {
    const raw = { desktop_coordinates: "0,0,10,10", mobile_coordinates: "0,0,10,10", source_width: 0, source_height: 10 };
    expect(parseEncuadreEntrada(raw).tipo).toBe("invalido");
  });
});

describe("encuadreParaImagen", () => {
  const encuadre = { desktop_coordinates: "1000,500,2000,1500", mobile_coordinates: "0,0,2268,3024" };

  it("sin foto no hay nada que encuadrar", () => {
    expect(encuadreParaImagen(encuadre, null, null)).toBeNull();
  });

  it("con el mismo tamaño deja las coordenadas como estaban", () => {
    expect(encuadreParaImagen(encuadre, { width: 4032, height: 3024 }, foto(4032, 3024))).toEqual(encuadre);
  });

  it("sin tamaño de origen no reescala ni acota: no se sabe en qué escala están", () => {
    // Este recorte se sale de 2400×1800. Acotarlo lo correría; la web tiene su propia corrección.
    expect(encuadreParaImagen(encuadre, null, foto(2400, 1800))).toEqual(encuadre);
  });

  it("lleva un recorte con zoom de la foto del celular al archivo acotado a 2400 px", () => {
    // 4032×3024 → 2400×1800: factor 2400/4032 en los dos ejes. El recorte de escritorio no toca
    // ningún borde (hay zoom), que es el caso que la heurística de la web no sabe corregir.
    expect(encuadreParaImagen(encuadre, { width: 4032, height: 3024 }, foto(2400, 1800))).toEqual({
      desktop_coordinates: "595,298,1190,893",
      mobile_coordinates: "0,0,1350,1800",
    });
  });

  it("si el redondeo deja el recorte un píxel afuera, lo mete adentro sin achicarlo", () => {
    const alBorde = { desktop_coordinates: "3001,0,1031,3024", mobile_coordinates: "0,0,10,10" };
    const resultado = encuadreParaImagen(alBorde, { width: 4032, height: 3024 }, foto(2400, 1800));
    const [x, , w] = resultado!.desktop_coordinates.split(",").map(Number);
    expect(x + w).toBeLessThanOrEqual(2400);
    expect(w).toBe(614);
  });

  it("descarta el encuadre si la proporción del origen no es la de la foto guardada (EXIF sin aplicar)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(encuadreParaImagen(encuadre, { width: 4032, height: 3024 }, foto(1800, 2400))).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("con una foto legacy sin medidas guarda las coordenadas redondeadas, sin reescalar", () => {
    const decimales = { desktop_coordinates: "10.4,20.6,300.2,400.7", mobile_coordinates: "0,0,10,10" };
    expect(encuadreParaImagen(decimales, { width: 4032, height: 3024 }, foto())).toEqual({
      desktop_coordinates: "10,21,300,401",
      mobile_coordinates: "0,0,10,10",
    });
  });
});
