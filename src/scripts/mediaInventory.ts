/**
 * Inventario de medios — SOLO LECTURA, no escribe una sola cosa.
 *
 *   npx ts-node src/scripts/mediaInventory.ts
 *   npx ts-node src/scripts/mediaInventory.ts --sizes     (además pide el peso actual con HEAD)
 *
 * Es el paso previo obligatorio al backfill: agrupa cada referencia de medio por colección y por
 * patrón de ruta, y muestra con qué modo se escribiría. Revisar esa tabla es cómo se comprueba que
 * ningún campo `String` del esquema va a recibir un objeto.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { buildInventory, measurePendingBytes } from "../services/mediaBackfill/inventory";

dotenv.config();

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const bucket = (process.env.GCS_BUCKET_RESORT || "").trim();
  if (!bucket) throw new Error("GCS_BUCKET_RESORT no está definido: sin bucket no se puede saber qué URL es nuestra.");
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL no está definido.");

  await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 20_000 });

  const inventory = await buildInventory(bucket);

  console.log(`\nBucket: ${bucket}`);
  if (inventory.missingCollections.length) {
    console.log(`Colecciones que no existen en esta base: ${inventory.missingCollections.join(", ")}`);
  }

  console.log("\n── Por colección y ruta ─────────────────────────────────────────────────────────");
  console.log(
    `${"colección".padEnd(20)} ${"ruta".padEnd(34)} ${"modo".padEnd(9)} ${"pend".padStart(5)} ${"migr".padStart(5)} ${"vid".padStart(4)} ${"ext".padStart(5)}`
  );
  for (const entry of inventory.entries) {
    const relevant =
      entry.counts.pendiente + entry.counts.migrada + entry.counts.revertida + entry.counts["sin-marca"];
    // Las rutas que solo tienen medios externos (fotos de Cloudbeds, assets locales del front) no
    // son trabajo de este pipeline: se resumen al final en vez de llenar la tabla.
    if (relevant === 0) continue;
    console.log(
      `${entry.collection.padEnd(20)} ${entry.pathPattern.slice(0, 34).padEnd(34)} ${entry.mode.padEnd(9)} ` +
        `${String(entry.counts.pendiente).padStart(5)} ${String(entry.counts.migrada).padStart(5)} ` +
        `${String(entry.counts.video).padStart(4)} ${String(entry.counts.externa).padStart(5)}`
    );
  }

  console.log("\n── Totales ──────────────────────────────────────────────────────────────────────");
  for (const [key, value] of Object.entries(inventory.totals).sort((a, b) => b[1] - a[1])) {
    if (value > 0) console.log(`  ${key.padEnd(12)} ${value}`);
  }

  const distinctPending = new Set(inventory.pending.map((item) => item.url)).size;
  console.log(
    `\n  ${inventory.pending.length} referencias pendientes en ${distinctPending} archivos distintos ` +
      `(la misma imagen puede estar referenciada en más de un sitio).`
  );

  const byMode = inventory.pending.reduce<Record<string, number>>((acc, item) => {
    acc[item.mode] = (acc[item.mode] || 0) + 1;
    return acc;
  }, {});
  console.log(`  Por modo de escritura: ${Object.entries(byMode).map(([m, n]) => `${m}=${n}`).join("  ") || "—"}`);

  if (process.argv.includes("--sizes")) {
    console.log("\n── Peso actual de lo pendiente (HEAD por archivo) ───────────────────────────────");
    const sizes = await measurePendingBytes(inventory.pending);
    console.log(`  archivos medidos ${sizes.measured}/${sizes.distinctUrls}` + (sizes.failed ? `, ${sizes.failed} sin respuesta` : ""));
    console.log(`  peso total: ${mb(sizes.bytes)}`);
    if (sizes.measured) console.log(`  promedio: ${kb(sizes.bytes / sizes.measured)}`);

    const heaviest = [...sizes.perUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (heaviest.length) {
      console.log("\n  Los más pesados:");
      const prefix = `https://storage.googleapis.com/${bucket}/`;
      for (const [url, size] of heaviest) {
        console.log(`    ${kb(size).padStart(9)}  ${url.replace(prefix, "")}`);
      }
    }
  } else {
    console.log("\n  (agregá --sizes para medir el peso actual con un HEAD por archivo)");
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("[mediaInventory]", error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
