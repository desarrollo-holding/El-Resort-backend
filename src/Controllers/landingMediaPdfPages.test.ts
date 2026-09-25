import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/csStorage.service", () => ({
  GcsStorageService: {
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    extractKeyFromUrl: vi.fn(() => null),
  },
}));

vi.mock("../services/pdfPages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/pdfPages")>()),
  uploadPdfPages: vi.fn(),
}));

import { GcsStorageService } from "../services/csStorage.service";
import { uploadPdfPages } from "../services/pdfPages";
import { normalizeJsonMediaNodes } from "./LandingMediaController";

const uploadFile = vi.mocked(GcsStorageService.uploadFile);
const convert = vi.mocked(uploadPdfPages);

type Node = Record<string, unknown>;
type Tree = { menuPdf: { es: Node } };

const PDF_URL = "https://storage.googleapis.com/b/files/1_carta-auca-village-es.pdf";
const page = (n: number) => ({
  src: `https://storage.googleapis.com/b/fotosresort/p${n}/orig.webp`,
  kind: "image" as const,
  status: "existing" as const,
  width: 1696,
  height: 2400,
  variants: [{ width: 480, height: 679, format: "webp", url: `https://storage.googleapis.com/b/fotosresort/p${n}/w480.webp` }],
});

function filesFor(key: string, file: Partial<Express.Multer.File>) {
  return new Map<string, Express.Multer.File[]>([[key, [{ buffer: Buffer.from("%PDF-1.4"), ...file } as Express.Multer.File]]]);
}

beforeEach(() => {
  uploadFile.mockReset();
  convert.mockReset();
});

describe("normalizeJsonMediaNodes: páginas de un PDF", () => {
  it("un PDF recién subido se guarda con una imagen por página, y todo queda en la lista de rollback", async () => {
    uploadFile.mockResolvedValueOnce({ fileId: "files/1_carta-auca-village-es.pdf", url: PDF_URL, variants: [] });
    convert.mockResolvedValueOnce({ pages: [page(1), page(2)], fileIds: ["fotosresort/p1/orig.webp", "fotosresort/p2/orig.webp"] });
    const uploadedFileIds: string[] = [];

    const result = (await normalizeJsonMediaNodes(
      { menuPdf: { es: { src: "media://carta", kind: "file" } } },
      filesFor("carta", { originalname: "carta-auca-village-es.pdf", mimetype: "application/pdf" }),
      uploadedFileIds
    )) as Tree;

    expect(convert).toHaveBeenCalledWith(expect.any(Buffer), "carta-auca-village-es.pdf");
    expect(result.menuPdf.es).toEqual({ src: PDF_URL, kind: "file", status: "existing", pages: [page(1), page(2)] });
    expect(uploadedFileIds).toEqual(["files/1_carta-auca-village-es.pdf", "fotosresort/p1/orig.webp", "fotosresort/p2/orig.webp"]);
  });

  it("un PDF nuevo no arrastra las páginas del anterior aunque el nodo las traiga", async () => {
    uploadFile.mockResolvedValueOnce({ fileId: "files/2_carta.pdf", url: "https://storage.googleapis.com/b/files/2_carta.pdf", variants: [] });
    convert.mockResolvedValueOnce({ pages: [page(9)], fileIds: ["fotosresort/p9/orig.webp"] });

    const result = (await normalizeJsonMediaNodes(
      { menuPdf: { es: { src: "media://carta", kind: "file", pages: [page(1), page(2)] } } },
      filesFor("carta", { originalname: "carta.pdf", mimetype: "application/pdf" }),
      []
    )) as Tree;

    expect(result.menuPdf.es.pages).toEqual([page(9)]);
  });

  it("un PDF que ya estaba guardado conserva sus páginas y no se vuelve a convertir", async () => {
    const result = (await normalizeJsonMediaNodes(
      { menuPdf: { es: { src: PDF_URL, kind: "file", status: "existing", pages: [page(1), page(2)] } } },
      new Map(),
      []
    )) as Tree;

    expect(convert).not.toHaveBeenCalled();
    expect(result.menuPdf.es).toEqual({ src: PDF_URL, kind: "file", status: "existing", pages: [page(1), page(2)] });
  });

  it("vaciar la ranura del PDF quita sus páginas (así la limpieza de huérfanos las borra del bucket)", async () => {
    const result = (await normalizeJsonMediaNodes(
      { menuPdf: { es: { src: "", kind: "file", status: "existing", pages: [page(1)] } } },
      new Map(),
      []
    )) as Tree;

    expect(result.menuPdf.es).toEqual({ src: "", kind: "file", status: "missing" });
  });

  it("un archivo que no es PDF no se convierte", async () => {
    uploadFile.mockResolvedValueOnce({ fileId: "files/3_lista.docx", url: "https://storage.googleapis.com/b/files/3_lista.docx", variants: [] });

    const result = (await normalizeJsonMediaNodes(
      { menuPdf: { es: { src: "media://doc", kind: "file" } } },
      filesFor("doc", {
        originalname: "lista.docx",
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      []
    )) as Tree;

    expect(convert).not.toHaveBeenCalled();
    expect(result.menuPdf.es).not.toHaveProperty("pages");
  });

  it("si la conversión falla, el error sale tal cual y el PDF ya subido queda en la lista de rollback", async () => {
    uploadFile.mockResolvedValueOnce({ fileId: "files/4_carta.pdf", url: "https://storage.googleapis.com/b/files/4_carta.pdf", variants: [] });
    const invalid = Object.assign(new Error("No se pudo convertir el PDF en imágenes para la web"), { status: 422 });
    convert.mockRejectedValueOnce(invalid);
    const uploadedFileIds: string[] = [];

    await expect(
      normalizeJsonMediaNodes(
        { menuPdf: { es: { src: "media://carta", kind: "file" } } },
        filesFor("carta", { originalname: "carta.pdf", mimetype: "application/pdf" }),
        uploadedFileIds
      )
    ).rejects.toBe(invalid);
    expect(uploadedFileIds).toEqual(["files/4_carta.pdf"]);
  });
});
