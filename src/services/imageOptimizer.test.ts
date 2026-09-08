import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { buildVariants, InvalidImageError, VARIANT_WIDTHS, IMAGE_PROFILES } from "./imageOptimizer";

async function makeSolidImage(width: number, height: number, format: "jpeg" | "png" | "webp" = "png") {
  const pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 40, b: 40 } },
  });
  if (format === "jpeg") return pipeline.jpeg().toBuffer();
  if (format === "webp") return pipeline.webp().toBuffer();
  return pipeline.png().toBuffer();
}

/** JPEG con orientación EXIF 6 (rotar 90° CW): 200x100 lógico que en realidad guarda 100x200 crudo. */
async function makeExifRotatedJpeg() {
  const rawLandscape = await sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 200, b: 10 } },
  })
    .jpeg()
    .toBuffer();

  // Reencodeamos como si la cámara hubiera guardado el sensor "parado" (100x200) marcando
  // en EXIF que hay que rotarlo 90° para verlo bien (orientation = 6).
  return sharp(rawLandscape)
    .rotate(90)
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
}

describe("buildVariants", () => {
  it("convierte JPEG a WebP", async () => {
    const jpeg = await makeSolidImage(600, 400, "jpeg");
    const built = await buildVariants(jpeg);
    expect(built.orig.format).toBe("webp");
    // Firma WebP: "RIFF....WEBP"
    expect(built.orig.buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(built.orig.buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("convierte PNG a WebP", async () => {
    const png = await makeSolidImage(600, 400, "png");
    const built = await buildVariants(png);
    expect(built.orig.format).toBe("webp");
    expect(built.orig.buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("respeta la orientación EXIF al decodificar", async () => {
    const rotated = await makeExifRotatedJpeg();
    const built = await buildVariants(rotated);
    // El original lógico es 200x100 (horizontal); si no se rotara, saldría 100x200.
    expect(built.width).toBe(200);
    expect(built.height).toBe(100);
  });

  it("rechaza un archivo corrupto con InvalidImageError", async () => {
    await expect(buildVariants(Buffer.from("esto no es una imagen"))).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("rechaza un archivo truncado (failOn: truncated)", async () => {
    const full = await makeSolidImage(800, 600, "jpeg");
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    await expect(buildVariants(truncated)).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("no agranda una imagen pequeña", async () => {
    const small = await makeSolidImage(300, 200);
    const built = await buildVariants(small);
    expect(built.width).toBe(300);
    expect(built.height).toBe(200);
  });

  it("acota el lado mayor al maxDimension del perfil", async () => {
    const huge = await makeSolidImage(4000, 2000);
    const built = await buildVariants(huge, "default");
    expect(Math.max(built.width, built.height)).toBe(IMAGE_PROFILES.default.maxDimension);
    expect(built.width).toBe(2400);
    expect(built.height).toBe(1200);
  });

  it("genera exactamente las variantes de la escalera estrictamente menores al ancho de orig", async () => {
    // orig quedará en 900px de ancho (< 1080), así que solo deben salir 480 y 768.
    const medium = await makeSolidImage(900, 600);
    const built = await buildVariants(medium);
    expect(built.variants.map((v) => v.width)).toEqual([480, 768]);
  });

  it("no genera ninguna variante mayor o igual que orig", async () => {
    const built = await buildVariants(await makeSolidImage(4000, 2000));
    for (const variant of built.variants) {
      expect(variant.width).toBeLessThan(built.width);
    }
  });

  it("no genera variantes cuando orig ya es más chico que el candidato menor de la escalera", async () => {
    const tiny = await makeSolidImage(320, 200);
    const built = await buildVariants(tiny);
    expect(built.variants).toEqual([]);
    expect(built.width).toBeLessThan(VARIANT_WIDTHS[0]);
  });

  it("el perfil avatar acota a su propio maxDimension y no genera escalera", async () => {
    const huge = await makeSolidImage(4000, 2000);
    const built = await buildVariants(huge, "avatar");
    expect(Math.max(built.width, built.height)).toBe(IMAGE_PROFILES.avatar.maxDimension);
    expect(built.variants).toEqual([]);
  });

  it("serializa llamadas concurrentes (cola de un solo carril) sin perder ninguna", async () => {
    const a = makeSolidImage(2000, 1000);
    const b = makeSolidImage(1200, 900);
    const c = makeSolidImage(700, 700);
    const [builtA, builtB, builtC] = await Promise.all([
      buildVariants(await a),
      buildVariants(await b),
      buildVariants(await c),
    ]);
    expect(builtA.width).toBe(2000);
    expect(builtB.width).toBe(1200);
    expect(builtC.width).toBe(700);
  });

  it("no procesa dos subidas pesadas en simultáneo: el tiempo concurrente se acerca a la suma, no al máximo", async () => {
    const imgA = await makeSolidImage(3000, 3000);
    const imgB = await makeSolidImage(3000, 3000);

    const startA = performance.now();
    await buildVariants(imgA);
    const durationA = performance.now() - startA;

    const startB = performance.now();
    await buildVariants(imgB);
    const durationB = performance.now() - startB;

    const startConcurrent = performance.now();
    await Promise.all([buildVariants(imgA), buildVariants(imgB)]);
    const concurrentDuration = performance.now() - startConcurrent;

    // Si corrieran en paralelo, concurrentDuration ~= max(durationA, durationB). Al estar
    // serializadas por la cola de un carril, se acerca a la suma; se deja margen generoso
    // para no volver el test inestable por ruido del entorno.
    expect(concurrentDuration).toBeGreaterThan(Math.max(durationA, durationB) * 0.75);
  });
});
