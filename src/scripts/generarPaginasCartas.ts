/**
 * Convierte en páginas-imagen las cartas en PDF que se subieron ANTES de que el backend lo hiciera
 * al guardarlas (services/pdfPages.ts). Solo toca `landingmedias`.
 *
 *   npm run media:cartas                          dry-run (por defecto): lista los PDF sin páginas
 *   npm run media:cartas -- --apply --limit 1     convierte uno y lo guarda: mirar el resultado
 *   npm run media:cartas -- --apply               el resto
 *
 * OJO: el `.env` local apunta a la base y al bucket de PRODUCCIÓN. Antes de `--apply`:
 *   npm run media:respaldo -- --collection landingmedias
 *
 * Cada página pasa por el mismo pipeline que una subida desde el panel (WebP + variantes, carpeta
 * nueva, nunca se sobreescribe nada). La hoja se escribe con un filtro por su `src` actual: si
 * alguien cambió esa carta desde el panel mientras el script trabajaba, no se pisa, y las páginas
 * que se acababan de subir se borran del bucket.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { GcsStorageService } from "../services/csStorage.service";
import { uploadPdfPages } from "../services/pdfPages";

dotenv.config();

const COLLECTION = "landingmedias";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

type PdfSinPaginas = { path: string[]; src: string };

/** Hojas `{ src: "….pdf" }` sin `pages`. No entra a los hijos de una hoja: sus páginas son imágenes. */
function pdfsSinPaginas(value: unknown, path: string[] = [], out: PdfSinPaginas[] = []): PdfSinPaginas[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => pdfsSinPaginas(item, [...path, String(index)], out));
    return out;
  }
  if (!value || typeof value !== "object") return out;

  const node = value as Record<string, unknown>;
  if (typeof node.src === "string") {
    const tienePaginas = Array.isArray(node.pages) && node.pages.length > 0;
    if (/\.pdf(?:$|[?#])/i.test(node.src.trim()) && !tienePaginas) out.push({ path, src: node.src });
    return out;
  }
  for (const [key, child] of Object.entries(node)) pdfsSinPaginas(child, [...path, key], out);
  return out;
}

async function descargar(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} al descargar ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL no está definido.");
  const apply = flag("apply");
  const limite = option("limit");

  await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 20_000 });
  const db = mongoose.connection.db;
  if (!db) throw new Error("Sin conexión a MongoDB");
  const coleccion = db.collection(COLLECTION);

  console.log(`\nModo: ${apply ? "APPLY (sube páginas y escribe en la base)" : "DRY-RUN (no escribe nada)"}`);
  console.log(`Bucket: ${process.env.GCS_BUCKET_RESORT}\n`);

  const pendientes: (PdfSinPaginas & { docId: mongoose.Types.ObjectId; nombre: string })[] = [];
  for await (const doc of coleccion.find({}, { projection: { nombre: 1, json: 1 } })) {
    for (const hoja of pdfsSinPaginas(doc.json)) pendientes.push({ ...hoja, docId: doc._id, nombre: String(doc.nombre) });
  }

  const aProcesar = limite !== undefined ? pendientes.slice(0, Number(limite)) : pendientes;
  console.log(`PDF sin páginas: ${pendientes.length}${limite !== undefined ? `   (--limit ${limite}: se procesan ${aProcesar.length})` : ""}\n`);

  let escritos = 0;
  let fallidos = 0;
  for (const [indice, hoja] of aProcesar.entries()) {
    const ruta = ["json", ...hoja.path].join(".");
    const etiqueta = `[${indice + 1}/${aProcesar.length}] ${hoja.nombre} ${hoja.path.join(".")}`;

    if (!apply) {
      console.log(`${etiqueta}\n      ${hoja.src}`);
      continue;
    }

    const inicio = Date.now();
    let subidas: string[] = [];
    try {
      const pdf = await descargar(hoja.src);
      const nombre = decodeURIComponent(new URL(hoja.src).pathname.split("/").pop() || "carta.pdf");
      const { pages, fileIds } = await uploadPdfPages(pdf, nombre);
      subidas = fileIds;

      const resultado = await coleccion.updateOne(
        { _id: hoja.docId, [`${ruta}.src`]: hoja.src },
        { $set: { [`${ruta}.pages`]: pages, updatedAt: new Date() } }
      );
      if (resultado.matchedCount === 0) {
        throw new Error("la carta cambió desde el panel mientras se convertía; no se escribió nada");
      }

      escritos++;
      const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
      console.log(`${etiqueta}: ${pages.length} páginas en ${segundos} s`);
    } catch (error) {
      fallidos++;
      await Promise.allSettled(subidas.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      console.error(`${etiqueta}: FALLÓ — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (apply) console.log(`\nEscritos: ${escritos}   fallidos: ${fallidos}`);
  await mongoose.disconnect();
  if (fallidos > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
