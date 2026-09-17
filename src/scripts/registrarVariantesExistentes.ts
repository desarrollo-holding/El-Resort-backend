/**
 * Registra en la base las variantes que YA EXISTEN en el bucket. No recodifica ni sube nada.
 *
 *   npx ts-node src/scripts/registrarVariantesExistentes.ts                     dry-run (por defecto)
 *   npx ts-node src/scripts/registrarVariantesExistentes.ts --collection landingmedias
 *   npx ts-node src/scripts/registrarVariantesExistentes.ts --apply
 *
 * POR QUÉ EXISTE, TENIENDO `mediaBackfill`
 * Hay imágenes que SÍ pasaron por el pipeline —su URL es un `<carpeta>/orig.webp` y sus
 * `w480.webp`, `w768.webp`… están en el bucket, comprobado— pero cuyo documento se quedó sin
 * `variants`, `width` ni `storagePrefix`. El caso real que motivó esto: los 29 slides de
 * `landingmedias.json.carouselImages`, que se guardaron con `src` y las coordenadas de encuadre y
 * nada más. Sin `variants`, el front no puede armar `srcset` y cada tarjeta baja el `orig.webp`.
 *
 * `mediaBackfill` los arregla, pero por el camino largo: descarga, DECODIFICA Y VUELVE A
 * CODIFICAR a WebP q80, y sube una carpeta nueva. Para una imagen que nunca pasó por el pipeline
 * eso es exactamente lo que hay que hacer. Para estas no: el `orig.webp` actual ya salió de este
 * mismo pipeline a q80, así que recodificarlo es una SEGUNDA GENERACIÓN con pérdida —en 29 fotos
 * grandes de la portada— para reconstruir archivos que ya están ahí. Y encima deja la carpeta
 * vieja huérfana en el bucket.
 *
 * Acá el trabajo es de metadatos: se comprueba qué variantes existen, se leen sus dimensiones
 * reales y se escriben en el documento. Los píxeles no se tocan, la URL no cambia y no se sube ni
 * un byte. Si una imagen NO tiene ninguna variante en el bucket, este script la deja en paz y la
 * informa: esa sí es trabajo para `mediaBackfill`.
 *
 * REVERSIÓN: `respaldoColecciones.ts` deja el documento entero antes de tocar nada.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { buildInventory, type PendingItem } from "../services/mediaBackfill/inventory";
import { VARIANT_WIDTHS } from "../services/imageOptimizer";

dotenv.config();

const PETICION_TIMEOUT_MS = 20_000;
const CONCURRENCIA = 8;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

type Encontrada = { width: number; height: number; format: "webp"; url: string };

/**
 * Lee ancho y alto de un WebP pidiendo solo sus primeros bytes con `Range`.
 *
 * Se leen de verdad en vez de deducirse de la proporción del `orig` porque un `resize({width})`
 * redondea el alto, y un alto deducido saldría con un píxel de más o de menos. Son 64 bytes por
 * archivo: no hay motivo para guardar un número aproximado pudiendo guardar el exacto.
 *
 * Los tres formatos de contenedor WebP guardan el tamaño en sitios distintos (VP8X extendido,
 * VP8L sin pérdida, VP8 con pérdida), de ahí las tres ramas.
 */
async function dimensionesWebp(url: string): Promise<{ width: number; height: number } | null> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      headers: { Range: "bytes=0-63" },
      signal: AbortSignal.timeout(PETICION_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!respuesta.ok && respuesta.status !== 206) return null;

  const b = Buffer.from(await respuesta.arrayBuffer());
  if (b.length < 30) return null;
  const chunk = b.subarray(12, 16).toString("ascii");

  if (chunk === "VP8X") {
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** `https://…/fotosresort/<ts>-<uuid>/orig.webp` → `https://…/fotosresort/<ts>-<uuid>` */
const carpetaDe = (url: string): string => url.slice(0, url.lastIndexOf("/"));

/** Clave del objeto dentro del bucket, que es lo que guarda `storageKey`/`storagePrefix`. */
function claveDe(url: string, bucket: string): string | null {
  const prefijo = `https://storage.googleapis.com/${bucket}/`;
  return url.startsWith(prefijo) ? url.slice(prefijo.length) : null;
}

async function inspeccionar(item: PendingItem): Promise<{
  item: PendingItem;
  orig: { width: number; height: number } | null;
  variantes: Encontrada[];
}> {
  const carpeta = carpetaDe(item.url);
  const orig = await dimensionesWebp(item.url);

  const variantes: Encontrada[] = [];
  for (const width of VARIANT_WIDTHS) {
    const url = `${carpeta}/w${width}.webp`;
    const dims = await dimensionesWebp(url);
    // Una variante que no existe devuelve 404 y `dimensionesWebp` da null. No es un error: el
    // pipeline solo genera las estrictamente más angostas que el `orig`, así que a una foto de
    // 900 px le faltan w1080, w1440 y w1920 con toda normalidad.
    if (dims) variantes.push({ width: dims.width, height: dims.height, format: "webp", url });
  }

  return { item, orig, variantes };
}

/** Recorre con concurrencia limitada: son peticiones a GCS, no hace falta abrir 200 a la vez. */
async function enLotes<T, R>(items: T[], tarea: (item: T) => Promise<R>, tamano: number): Promise<R[]> {
  const salida: R[] = [];
  for (let i = 0; i < items.length; i += tamano) {
    salida.push(...(await Promise.all(items.slice(i, i + tamano).map(tarea))));
  }
  return salida;
}

async function main() {
  const bucket = (process.env.GCS_BUCKET_RESORT || "").trim();
  if (!bucket) throw new Error("GCS_BUCKET_RESORT no está definido.");
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL no está definido.");

  const apply = flag("apply");
  const soloColeccion = option("collection");

  await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 20_000 });
  const db = mongoose.connection.db;
  if (!db) throw new Error("Sin conexión a MongoDB");

  console.log(`\nModo: ${apply ? "APPLY (escribe en la base)" : "DRY-RUN (no escribe nada)"}`);
  console.log(`Bucket: ${bucket}`);

  const inventario = await buildInventory(bucket);
  let pendientes = inventario.pending;
  if (soloColeccion) pendientes = pendientes.filter((p) => p.collection === soloColeccion);

  // Solo las que ya apuntan a un `orig.webp` del pipeline: si la URL es otra cosa, la imagen nunca
  // pasó por acá y lo que necesita es el backfill de verdad, no un registro de metadatos.
  const candidatas = pendientes.filter((p) => p.url.endsWith("/orig.webp") && p.mode === "asset");
  const noAplican = pendientes.length - candidatas.length;

  console.log(`Pendientes: ${pendientes.length}   candidatas (ya en el pipeline): ${candidatas.length}\n`);

  const inspeccionadas = await enLotes(candidatas, inspeccionar, CONCURRENCIA);

  let conVariantes = inspeccionadas.filter((r) => r.variantes.length > 0 && r.orig);
  const limite = option("limit");
  if (limite !== undefined) {
    // Para la primera pasada contra producción: se escribe una y se mira el documento antes de
    // soltar las 30. Se aplica DESPUÉS de inspeccionar para que el recuento de "sin variantes"
    // siga siendo el real y no el de la muestra.
    conVariantes = conVariantes.slice(0, Number(limite));
    console.log(`  (--limit ${limite}: se procesan solo las primeras ${conVariantes.length})\n`);
  }
  const sinVariantes = inspeccionadas.filter((r) => r.variantes.length === 0 || !r.orig);

  let escritas = 0;
  let fallidas = 0;

  for (const [indice, resultado] of conVariantes.entries()) {
    const { item, orig, variantes } = resultado;
    const etiqueta = `${item.collection}.${item.path}`;
    const resumen = variantes.map((v) => v.width).join("/");

    if (!apply) {
      console.log(`[${String(indice + 1).padStart(3)}/${conVariantes.length}] registraría ${etiqueta.padEnd(46)} ${orig!.width}px  variantes ${resumen}`);
      continue;
    }

    // Se relee el valor actual justo antes de escribir, por el mismo motivo que `mediaBackfill`:
    // entre que se armó el inventario y esta línea, alguien pudo haber subido otra imagen por esa
    // ruta desde el panel, y pisarla con los metadatos de la anterior sería peor que no hacer nada.
    const doc = await db.collection(item.collection).findOne({ _id: new mongoose.Types.ObjectId(item.docId) });
    const previo = doc
      ? item.path.split(".").reduce<unknown>((acc, clave) => {
          if (acc === null || acc === undefined) return undefined;
          if (Array.isArray(acc)) return acc[Number(clave)];
          if (typeof acc === "object") return (acc as Record<string, unknown>)[clave];
          return undefined;
        }, doc)
      : undefined;

    const urlActual =
      previo && typeof previo === "object"
        ? String((previo as Record<string, unknown>).src ?? (previo as Record<string, unknown>).url ?? "")
        : typeof previo === "string"
          ? previo
          : "";

    if (urlActual.trim() !== item.url) {
      console.log(`[${String(indice + 1).padStart(3)}/${conVariantes.length}] OMITIDA   ${etiqueta} (cambió desde el inventario)`);
      fallidas += 1;
      continue;
    }

    const anterior = previo && typeof previo === "object" && !Array.isArray(previo) ? (previo as Record<string, unknown>) : {};
    const claveOrig = claveDe(item.url, bucket);
    const prefijo = claveOrig ? claveOrig.slice(0, claveOrig.lastIndexOf("/")) : "";

    // `...anterior` primero, y no al revés: `desktop_coordinates`, `mobile_coordinates`,
    // `sortIndex`, `kind` y `status` tienen que sobrevivir intactos. Perder las coordenadas
    // rompería el encuadre de los 29 slides sin que falle nada.
    const nuevo = {
      ...anterior,
      [item.shape === "leaf" ? "src" : "url"]: item.url,
      storageKey: claveOrig ?? "",
      storagePrefix: prefijo,
      width: orig!.width,
      height: orig!.height,
      variants: variantes,
    };

    const resultadoEscritura = await db
      .collection(item.collection)
      .updateOne({ _id: new mongoose.Types.ObjectId(item.docId) }, { $set: { [item.path]: nuevo } });

    if (resultadoEscritura.matchedCount !== 1) {
      console.log(`[${String(indice + 1).padStart(3)}/${conVariantes.length}] FALLIDA   ${etiqueta} (el documento ya no existe)`);
      fallidas += 1;
      continue;
    }

    escritas += 1;
    console.log(`[${String(indice + 1).padStart(3)}/${conVariantes.length}] registrada ${etiqueta.padEnd(46)} ${orig!.width}px  variantes ${resumen}`);
  }

  console.log("\n── Resultado ────────────────────────────────────────────────────────────────────");
  if (apply) {
    console.log(`  registradas ${escritas}   fallidas ${fallidas}`);
  } else {
    console.log(`  se registrarían ${conVariantes.length}`);
  }
  if (sinVariantes.length) {
    console.log(`\n  ${sinVariantes.length} sin ninguna variante en el bucket — esas SÍ necesitan mediaBackfill:`);
    for (const r of sinVariantes.slice(0, 10)) console.log(`    ${r.item.collection}.${r.item.path}`);
    if (sinVariantes.length > 10) console.log(`    …y ${sinVariantes.length - 10} más`);
  }
  if (noAplican) {
    console.log(`\n  ${noAplican} pendientes que no apuntan a un orig.webp del pipeline: son para mediaBackfill.`);
  }
  if (!apply) console.log(`\n  Nada se escribió. Volvé a correrlo con --apply.`);
  console.log("");

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("\n[registrarVariantes] falló:", error?.message || error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
