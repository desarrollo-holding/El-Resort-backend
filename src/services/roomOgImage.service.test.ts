import { describe, it, expect } from "vitest";
import { computeOgCrop, parseCropCoordinates, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT } from "./roomOgImage.service";

const RATIO = OG_IMAGE_WIDTH / OG_IMAGE_HEIGHT;
const ratioOf = (r: { w: number; h: number }) => r.w / r.h;

/** Un rectángulo contiene a otro. */
const contains = (outer: { x: number; y: number; w: number; h: number }, inner: typeof outer) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.w >= inner.x + inner.w &&
  outer.y + outer.h >= inner.y + inner.h;

describe("parseCropCoordinates", () => {
  it("lee el formato que guarda el panel", () => {
    expect(parseCropCoordinates("0,47,655,820")).toEqual({ x: 0, y: 47, w: 655, h: 820 });
  });

  it("descarta lo que no sirve como encuadre", () => {
    expect(parseCropCoordinates("0,47,655")).toBeNull();
    expect(parseCropCoordinates("0,47,0,820")).toBeNull();
    expect(parseCropCoordinates("a,b,c,d")).toBeNull();
    expect(parseCropCoordinates(undefined)).toBeNull();
    expect(parseCropCoordinates({ x: 1 })).toBeNull();
  });
});

describe("computeOgCrop", () => {
  it("ensancha el encuadre vertical sin comerle nada de alto, cuando la foto da a los lados", () => {
    // Caso real: Casa Vibras 56, portada 1200×1600 y encuadre móvil vertical.
    const bounds = { width: 1200, height: 1600 };
    const rect = { x: 0, y: 49, w: 1200, h: 1502 };
    const crop = computeOgCrop(bounds, rect);

    expect(ratioOf(crop)).toBeCloseTo(RATIO, 2);
    // La foto no es más ancha que el encuadre, así que acá SÍ hay que recortar en alto; lo que se
    // comprueba es que se conserve todo el ancho disponible antes de tocar el alto.
    expect(crop.w).toBe(1200);
    expect(crop.h).toBe(Math.round(1200 / RATIO));
  });

  it("no pierde nada de lo encuadrado cuando la foto es lo bastante ancha", () => {
    const bounds = { width: 2000, height: 1000 };
    const rect = { x: 800, y: 200, w: 400, h: 500 };
    const crop = computeOgCrop(bounds, rect);

    expect(ratioOf(crop)).toBeCloseTo(RATIO, 2);
    expect(contains(crop, rect)).toBe(true);
  });

  it("mantiene centrado el sujeto del encuadre", () => {
    const bounds = { width: 2000, height: 1000 };
    const rect = { x: 800, y: 200, w: 400, h: 500 };
    const crop = computeOgCrop(bounds, rect);

    expect(crop.x + crop.w / 2).toBeCloseTo(rect.x + rect.w / 2, 0);
    expect(crop.y + crop.h / 2).toBeCloseTo(rect.y + rect.h / 2, 0);
  });

  it("corre el recorte hacia adentro en vez de salirse por el borde", () => {
    const bounds = { width: 2000, height: 1000 };
    // Encuadre pegado al borde izquierdo: centrar el 1.91:1 en él lo sacaría de la imagen.
    const crop = computeOgCrop(bounds, { x: 0, y: 0, w: 200, h: 400 });

    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.x + crop.w).toBeLessThanOrEqual(bounds.width);
    expect(crop.y + crop.h).toBeLessThanOrEqual(bounds.height);
  });

  it("acota un encuadre más grande que la propia foto", () => {
    // El panel guarda las coordenadas en el espacio del original y hay fichas con valores que se
    // pasan de sus dimensiones; sin acotar, `sharp.extract` tiraría.
    const bounds = { width: 2400, height: 1800 };
    const crop = computeOgCrop(bounds, { x: 0, y: 0, w: 3176, h: 3024 });

    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.w).toBeLessThanOrEqual(bounds.width);
    expect(crop.y + crop.h).toBeLessThanOrEqual(bounds.height);
    expect(ratioOf(crop)).toBeCloseTo(RATIO, 2);
  });

  it("achica en alto solo cuando la foto no da más de sí a lo ancho", () => {
    const bounds = { width: 656, height: 913 };
    const crop = computeOgCrop(bounds, { x: 0, y: 47, w: 655, h: 820 });

    expect(crop.w).toBe(656);
    expect(crop.h).toBe(Math.round(656 / RATIO));
    expect(ratioOf(crop)).toBeCloseTo(RATIO, 2);
  });

  it("devuelve siempre un recorte válido para sharp.extract", () => {
    const casos = [
      [{ width: 1, height: 1 }, { x: 0, y: 0, w: 1, h: 1 }],
      [{ width: 100, height: 4000 }, { x: 10, y: 10, w: 50, h: 3000 }],
      [{ width: 4000, height: 100 }, { x: 10, y: 10, w: 3000, h: 50 }],
      [{ width: 800, height: 600 }, { x: -500, y: -500, w: 100, h: 100 }],
    ] as const;

    for (const [bounds, rect] of casos) {
      const crop = computeOgCrop(bounds, rect);
      expect(crop.w).toBeGreaterThan(0);
      expect(crop.h).toBeGreaterThan(0);
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.w).toBeLessThanOrEqual(bounds.width);
      expect(crop.y + crop.h).toBeLessThanOrEqual(bounds.height);
    }
  });
});
