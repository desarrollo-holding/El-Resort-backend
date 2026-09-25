import path from "node:path";
import { GcsStorageService } from "./csStorage.service";
import { enqueueImageWork } from "./imageOptimizer";
import { toHttpError } from "../utils/errors";

/**
 * Convierte cada página de un PDF subido al landing (la carta de cada espacio de AUCA) en una
 * imagen que pasa por el mismo pipeline que cualquier foto: `orig.webp` + escalera de variantes
 * para `srcset`. El sitio muestra esas páginas; el PDF queda para "Abrir en otra pestaña".
 *
 * POR QUÉ EN EL SERVIDOR
 * El sitio dibujaba la carta con pdf.js en el navegador, que descomprime cada imagen del PDF a su
 * tamaño completo antes de achicarla. Las cartas vienen exportadas para imprenta: siluetas de
 * 4216×5968 y una ilustración de 10241×15089, que en un PDF de 1,4 MB ocupan ~300 MB en memoria
 * (1,6 GB la de Vibras). En iPhone Safari cierra la pestaña ("A problem repeatedly occurred") o
 * salta las imágenes en JPEG 2000, y en todos lados la carta tardaba en aparecer cada vez que se
 * abría. Acá se hace UNA vez, al subirla, y el teléfono recibe páginas de ~250 KB que se cachean
 * como cualquier foto.
 */

/**
 * Lado mayor de cada página. Es el techo del pipeline de imágenes (`IMAGE_PROFILES.default`), que
 * acotaría igual una página más grande: dibujarla a más resolución sería trabajo que sharp tira.
 */
const PAGE_LONG_SIDE = 2400;

/** Las cartas reales tienen 4 y 13 páginas. Con muchas más la subida tardaría minutos. */
export const MAX_PDF_PAGES = 40;

/**
 * pdf.js no decodifica imágenes de más píxeles que esto: corta un PDF "bomba" antes de que tumbe el
 * proceso, sin tocar las cartas reales (la imagen más grande que traen es de 154 MP).
 */
const MAX_IMAGE_PIXELS = 250e6;

export type PdfPageNode = {
  src: string;
  kind: "image";
  status: "existing";
  width?: number;
  height?: number;
  variants: unknown[];
};

export function isPdfFile(originalName: string, mimeType: string): boolean {
  return mimeType.trim().toLowerCase() === "application/pdf" || /\.pdf$/i.test(originalName.trim());
}

// Los tipos salen del propio `import()`: un `import type` de un módulo ESM desde este archivo CJS
// exigiría el atributo `resolution-mode`.
const importPdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs");
type Pdfjs = Awaited<ReturnType<typeof importPdfjs>>;
type PDFDocumentProxy = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
type Canvas = typeof import("@napi-rs/canvas");
let librariesPromise: Promise<{ pdfjs: Pdfjs; createCanvas: Canvas["createCanvas"] }> | undefined;

/**
 * pdf.js (ESM) y el canvas nativo se cargan con `import()` —con `module: NodeNext` tsc lo deja tal
 * cual en el CJS compilado— y recién la primera vez que se sube un PDF. Así no pesan en cada
 * arranque y, sobre todo, si el binario del canvas no cargara en el servidor fallaría solo la
 * subida del PDF, no el arranque de toda la API. pdf.js necesita Node 22 (`Promise.withResolvers`,
 * `process.getBuiltinModule`): ver `engines` en package.json.
 */
function loadLibraries() {
  librariesPromise ??= Promise.all([importPdfjs(), import("@napi-rs/canvas")]).then(
    ([pdfjs, canvas]) => ({ pdfjs, createCanvas: canvas.createCanvas }),
    (error: unknown) => {
      librariesPromise = undefined;
      throw error;
    }
  );
  return librariesPromise;
}

/**
 * En Node pdf.js lee del disco sus archivos auxiliares: el decodificador de JPEG 2000 (las cartas
 * en inglés vienen así), el de JBIG2, las fuentes estándar y los CMaps. Pide rutas con `/` final.
 */
function pdfjsDataDir(subdir: string): string {
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return `${path.join(root, subdir).split(path.sep).join("/")}/`;
}

async function renderPage(doc: PDFDocumentProxy, pageNumber: number, createCanvas: Canvas["createCanvas"]): Promise<Buffer> {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PAGE_LONG_SIDE / Math.max(base.width, base.height) });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    // PNG: sin pérdida, así la única compresión con pérdida es la del pipeline al pasarla a WebP.
    return await canvas.encode("png");
  } finally {
    page.cleanup();
  }
}

/**
 * Abre el PDF y le pasa cada página dibujada a `onPage`, de a una: la página se sube antes de
 * dibujar la siguiente, así nunca hay más de una en memoria. Cada dibujo va por el mismo carril que
 * el trabajo de sharp (`enqueueImageWork`): decodificar las imágenes del PDF es lo que más memoria
 * pide en todo el backend, y no debe coincidir con otra subida.
 */
async function forEachRenderedPage(pdf: Buffer, onPage: (png: Buffer, pageNumber: number) => Promise<void>): Promise<number> {
  const { pdfjs, createCanvas } = await loadLibraries();
  const task = pdfjs.getDocument({
    // Copia: pdf.js se queda con el buffer que recibe.
    data: new Uint8Array(pdf),
    wasmUrl: pdfjsDataDir("wasm"),
    standardFontDataUrl: pdfjsDataDir("standard_fonts"),
    cMapUrl: pdfjsDataDir("cmaps"),
    cMapPacked: true,
    maxImageSize: MAX_IMAGE_PIXELS,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });

  try {
    let doc: PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch (error) {
      throw conversionError(error);
    }
    if (doc.numPages > MAX_PDF_PAGES) {
      throw toHttpError(422, `El PDF tiene ${doc.numPages} páginas; el máximo es ${MAX_PDF_PAGES}.`);
    }

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      let png: Buffer;
      try {
        png = await enqueueImageWork(() => renderPage(doc, pageNumber, createCanvas));
      } catch (error) {
        throw conversionError(error, pageNumber);
      }
      await onPage(png, pageNumber);
    }
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}

/**
 * Un PDF que no se puede dibujar es un problema del archivo, no del servidor: 422 con un mensaje
 * que el panel muestra tal cual. Los errores de la subida al bucket no pasan por acá y salen como
 * lo que son.
 */
function conversionError(error: unknown, pageNumber?: number) {
  const detail = error instanceof Error ? error.message : String(error);
  const where = pageNumber ? ` (página ${pageNumber})` : "";
  return toHttpError(
    422,
    `No se pudo convertir el PDF en imágenes para la web${where}: ${detail}. Si se abre bien en la computadora, exportarlo de nuevo suele resolverlo.`
  );
}

/** Dibuja todas las páginas y devuelve sus PNG. Para tests y diagnóstico: no sube nada. */
export async function renderPdfPagesToPng(pdf: Buffer): Promise<Buffer[]> {
  const pages: Buffer[] = [];
  await forEachRenderedPage(pdf, async (png) => {
    pages.push(png);
  });
  return pages;
}

type MediaLeaf = Record<string, unknown> & { src: string };

const hasPages = (leaf: MediaLeaf) => Array.isArray(leaf.pages) && leaf.pages.length > 0;

/** Hojas `{ src: "….pdf" }` del árbol de medios. No entra a los hijos de una hoja: sus páginas son imágenes. */
function collectPdfLeaves(value: unknown, out: MediaLeaf[] = []): MediaLeaf[] {
  if (Array.isArray(value)) {
    for (const item of value) collectPdfLeaves(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;

  const node = value as Record<string, unknown>;
  if (typeof node.src === "string") {
    if (/\.pdf(?:$|[?#])/i.test(node.src.trim())) out.push(node as MediaLeaf);
    return out;
  }
  for (const child of Object.values(node)) collectPdfLeaves(child, out);
  return out;
}

/**
 * Una hoja de PDF que llega sin `pages` pero con el mismo `src` que ya tenía páginas guardadas las
 * recupera. Pasa cuando guarda un panel abierto desde antes de que existieran: ya ocurrió que uno
 * volviera a guardar la sección del restaurante con datos de horas antes. Sin esto el guardado las
 * sacaría del árbol y `cleanupOrphanedLandingMedia` las borraría del bucket. Modifica `next`.
 */
export function keepSavedPdfPages(previous: unknown, next: unknown): void {
  const saved = new Map<string, unknown>();
  for (const leaf of collectPdfLeaves(previous)) {
    if (hasPages(leaf)) saved.set(leaf.src.trim(), leaf.pages);
  }
  if (saved.size === 0) return;

  for (const leaf of collectPdfLeaves(next)) {
    const pages = saved.get(leaf.src.trim());
    if (pages && !hasPages(leaf)) leaf.pages = structuredClone(pages);
  }
}

/**
 * Convierte los PDF del árbol que siguen sin páginas: los subidos antes de que existiera esto, o una
 * carta que un panel desactualizado devolvió a un archivo anterior. Solo los de nuestro bucket.
 * Nunca hace fallar el guardado —el usuario no subió nada nuevo—: si un PDF no se puede convertir,
 * queda sin páginas (el sitio lo dibuja con pdf.js, como antes) y se registra el error.
 * Las páginas subidas van a `uploadedFileIds`, la lista de rollback del guardado. Modifica `json`.
 */
export async function addMissingPdfPages(json: unknown, uploadedFileIds: string[]): Promise<void> {
  for (const leaf of collectPdfLeaves(json)) {
    const src = leaf.src.trim();
    if (hasPages(leaf) || !GcsStorageService.extractKeyFromUrl(src)) continue;

    try {
      const response = await fetch(src, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} al descargarlo`);
      const name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "carta.pdf");
      const { pages, fileIds } = await uploadPdfPages(Buffer.from(await response.arrayBuffer()), name);
      uploadedFileIds.push(...fileIds);
      leaf.pages = pages;
    } catch (error) {
      console.error(`[pdfPages] No se pudieron generar las páginas de ${src}:`, error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Convierte el PDF en páginas y las sube como imágenes. Devuelve los nodos para guardar en la hoja
 * del PDF (`pages`) y las keys subidas, para que el llamador pueda deshacer la subida si algo falla
 * después. Si falla a mitad de camino, borra las páginas que ya había subido antes de propagar el
 * error: sin eso quedarían carpetas en el bucket que ningún documento referencia.
 */
export async function uploadPdfPages(pdf: Buffer, originalName: string): Promise<{ pages: PdfPageNode[]; fileIds: string[] }> {
  const baseName = path.basename(originalName.trim(), path.extname(originalName.trim())) || "pdf";
  const pages: PdfPageNode[] = [];
  const fileIds: string[] = [];

  try {
    await forEachRenderedPage(pdf, async (png, pageNumber) => {
      const uploaded = await GcsStorageService.uploadFile({
        fileBuffer: png,
        originalName: `${baseName}-p${pageNumber}.png`,
        mimeType: "image/png",
        mediaKind: "image",
      });
      fileIds.push(uploaded.fileId);
      pages.push({
        src: uploaded.url,
        kind: "image",
        status: "existing",
        width: uploaded.width,
        height: uploaded.height,
        variants: uploaded.variants ?? [],
      });
    });
  } catch (error) {
    await Promise.allSettled(fileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
    throw error;
  }

  return { pages, fileIds };
}
