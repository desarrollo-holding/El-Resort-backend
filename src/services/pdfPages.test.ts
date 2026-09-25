import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("./csStorage.service", () => ({
  GcsStorageService: {
    uploadFile: vi.fn(),
    deleteFile: vi.fn(async () => ({ success: true })),
    // Solo las URLs de "nuestro" bucket de prueba tienen key.
    extractKeyFromUrl: vi.fn((url: string) => (url.includes("/bucket-propio/") ? url.split("/bucket-propio/")[1] : null)),
  },
}));

import { GcsStorageService } from "./csStorage.service";
import {
  MAX_PDF_PAGES,
  addMissingPdfPages,
  isPdfFile,
  keepSavedPdfPages,
  renderPdfPagesToPng,
  uploadPdfPages,
} from "./pdfPages";

const uploadFile = vi.mocked(GcsStorageService.uploadFile);
const deleteFile = vi.mocked(GcsStorageService.deleteFile);

/**
 * PDF mínimo pero válido (con su tabla xref): cada página pinta un cuadrado rojo de 100 pt en la
 * esquina inferior izquierda, para comprobar que la página se dibujó y no salió en blanco.
 */
function buildPdf(pages: { width: number; height: number }[]): Buffer {
  const objects: string[] = [];
  const kids: number[] = [];
  let next = 3;
  for (const page of pages) {
    const pageRef = next++;
    const contentRef = next++;
    const content = "1 0 0 rg 0 0 100 100 re f";
    kids.push(pageRef);
    objects[pageRef] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents ${contentRef} 0 R >>`;
    objects[contentRef] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let ref = 1; ref < objects.length; ref++) {
    offsets[ref] = Buffer.byteLength(out, "latin1");
    out += `${ref} 0 obj\n${objects[ref]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let ref = 1; ref < objects.length; ref++) out += `${String(offsets[ref]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const A4 = { width: 595, height: 842 };
const A4_LANDSCAPE = { width: 842, height: 595 };

async function pixel(png: Buffer, left: number, top: number) {
  const data = await sharp(png).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  return { r: data[0], g: data[1], b: data[2] };
}

beforeEach(() => {
  uploadFile.mockReset();
  deleteFile.mockClear();
});

describe("isPdfFile", () => {
  it("reconoce el PDF por tipo o por extensión (Windows a veces manda octet-stream)", () => {
    expect(isPdfFile("carta.pdf", "application/pdf")).toBe(true);
    expect(isPdfFile("carta-auca-village-es.PDF", "application/octet-stream")).toBe(true);
    expect(isPdfFile("foto.png", "image/png")).toBe(false);
  });
});

describe("renderPdfPagesToPng", () => {
  it("dibuja cada página con su lado mayor en 2400 px y su orientación", async () => {
    const pages = await renderPdfPagesToPng(buildPdf([A4, A4_LANDSCAPE]));

    expect(pages).toHaveLength(2);
    const [portrait, landscape] = await Promise.all(pages.map((png) => sharp(png).metadata()));
    expect(portrait).toMatchObject({ format: "png", width: 1696, height: 2400 });
    expect(landscape).toMatchObject({ format: "png", width: 2400, height: 1696 });
  });

  it("dibuja el contenido: el cuadrado rojo sale rojo y el resto del fondo blanco", async () => {
    const [png] = await renderPdfPagesToPng(buildPdf([A4]));

    expect(await pixel(png, 50, 2400 - 50)).toEqual({ r: 255, g: 0, b: 0 });
    expect(await pixel(png, 1000, 500)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("rechaza con 422 un archivo que no es un PDF", async () => {
    await expect(renderPdfPagesToPng(Buffer.from("esto no es un pdf"))).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/No se pudo convertir el PDF/),
    });
  });

  it(`rechaza con 422 un PDF de más de ${MAX_PDF_PAGES} páginas sin dibujar ninguna`, async () => {
    const pdf = buildPdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => A4));
    await expect(renderPdfPagesToPng(pdf)).rejects.toMatchObject({
      status: 422,
      message: `El PDF tiene ${MAX_PDF_PAGES + 1} páginas; el máximo es ${MAX_PDF_PAGES}.`,
    });
  });
});

describe("uploadPdfPages", () => {
  const uploaded = (n: number) => ({
    fileId: `fotosresort/p${n}/orig.webp`,
    url: `https://storage.googleapis.com/b/fotosresort/p${n}/orig.webp`,
    width: 1696,
    height: 2400,
    variants: [{ width: 480, height: 679, format: "webp" as const, url: `https://storage.googleapis.com/b/fotosresort/p${n}/w480.webp` }],
  });

  it("sube cada página por el pipeline de imágenes y devuelve una hoja de imagen por página", async () => {
    uploadFile.mockResolvedValueOnce(uploaded(1)).mockResolvedValueOnce(uploaded(2));

    const result = await uploadPdfPages(buildPdf([A4, A4]), "carta-auca-village-es.pdf");

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile.mock.calls[0][0]).toMatchObject({
      originalName: "carta-auca-village-es-p1.png",
      mimeType: "image/png",
      mediaKind: "image",
    });
    expect(result.fileIds).toEqual(["fotosresort/p1/orig.webp", "fotosresort/p2/orig.webp"]);
    expect(result.pages).toEqual([
      { src: uploaded(1).url, kind: "image", status: "existing", width: 1696, height: 2400, variants: uploaded(1).variants },
      { src: uploaded(2).url, kind: "image", status: "existing", width: 1696, height: 2400, variants: uploaded(2).variants },
    ]);
  });

  it("si falla la subida de una página, borra las que ya subió y propaga el error tal cual", async () => {
    const gcsDown = Object.assign(new Error("GCS no responde"), { status: 503 });
    uploadFile.mockResolvedValueOnce(uploaded(1)).mockRejectedValueOnce(gcsDown);

    await expect(uploadPdfPages(buildPdf([A4, A4, A4]), "carta.pdf")).rejects.toBe(gcsDown);
    expect(deleteFile).toHaveBeenCalledWith({ fileId: "fotosresort/p1/orig.webp" });
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });
});

describe("keepSavedPdfPages", () => {
  const PDF = "https://storage.googleapis.com/bucket-propio/files/1_carta.pdf";
  const pages = [{ src: "https://storage.googleapis.com/bucket-propio/fotosresort/p1/orig.webp", kind: "image" }];

  it("devuelve las páginas guardadas a una hoja con el mismo PDF que llegó sin ellas (panel desactualizado)", () => {
    const next = { menuPdf: { es: { src: PDF, kind: "file" } as Record<string, unknown> } };

    keepSavedPdfPages({ menuPdf: { es: { src: PDF, kind: "file", pages } } }, next);

    expect(next.menuPdf.es.pages).toEqual(pages);
    expect(next.menuPdf.es.pages).not.toBe(pages);
  });

  it("no le pasa páginas a un PDF distinto ni pisa las que ya trae la hoja", () => {
    const otras = [{ src: "https://storage.googleapis.com/bucket-propio/fotosresort/p9/orig.webp", kind: "image" }];
    const next = {
      a: { src: "https://storage.googleapis.com/bucket-propio/files/2_carta.pdf", kind: "file" } as Record<string, unknown>,
      b: { src: PDF, kind: "file", pages: otras } as Record<string, unknown>,
    };

    keepSavedPdfPages({ a: { src: PDF, kind: "file", pages }, b: { src: PDF, kind: "file", pages } }, next);

    expect(next.a).not.toHaveProperty("pages");
    expect(next.b.pages).toBe(otras);
  });
});

describe("addMissingPdfPages", () => {
  const PDF = "https://storage.googleapis.com/bucket-propio/files/1_carta-auca-vibras-es.pdf";
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("convierte un PDF del bucket que no tiene páginas y suma lo subido a la lista de rollback", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(buildPdf([A4]))));
    uploadFile.mockResolvedValueOnce({ fileId: "fotosresort/p1/orig.webp", url: "https://x/p1/orig.webp", width: 1696, height: 2400, variants: [] });
    const json = { menuPdf: { es: { src: PDF, kind: "file" } as Record<string, unknown> } };
    const uploadedFileIds: string[] = [];

    await addMissingPdfPages(json, uploadedFileIds);

    expect(fetchMock).toHaveBeenCalledWith(PDF, expect.anything());
    expect(json.menuPdf.es.pages).toEqual([
      { src: "https://x/p1/orig.webp", kind: "image", status: "existing", width: 1696, height: 2400, variants: [] },
    ]);
    expect(uploadedFileIds).toEqual(["fotosresort/p1/orig.webp"]);
  });

  it("no descarga nada si el PDF ya tiene páginas o no es de nuestro bucket", async () => {
    await addMissingPdfPages(
      {
        conPaginas: { src: PDF, kind: "file", pages: [{ src: "https://x/p1/orig.webp" }] },
        ajeno: { src: "https://otro-sitio.com/carta.pdf", kind: "file" },
      },
      []
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si no puede convertirlo no hace fallar el guardado: la hoja queda como estaba", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no existe", { status: 404 }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const json = { menuPdf: { es: { src: PDF, kind: "file" } as Record<string, unknown> } };

    await expect(addMissingPdfPages(json, [])).resolves.toBeUndefined();

    expect(json.menuPdf.es).not.toHaveProperty("pages");
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(PDF), expect.stringContaining("404"));
    consoleError.mockRestore();
  });
});
