/**
 * Backfill de medios: recodifica a WebP y genera la escalera de variantes de todo lo que se subió
 * antes de que existiera el pipeline.
 *
 *   npx ts-node src/scripts/mediaBackfill.ts                          dry-run (por defecto)
 *   npx ts-node src/scripts/mediaBackfill.ts --limit 3 --apply        migra 3 y para
 *   npx ts-node src/scripts/mediaBackfill.ts --collection areas --apply
 *   npx ts-node src/scripts/mediaBackfill.ts --apply                  la corrida completa
 *   npx ts-node src/scripts/mediaBackfill.ts --rollback respaldos/<archivo>.json
 *
 * EL DRY-RUN ES EL MODO POR DEFECTO A PROPÓSITO. `--apply` reescribe documentos de producción y
 * sube objetos al bucket; que eso requiera escribirlo explícitamente es la diferencia entre una
 * corrida deliberada y un `↑ Enter` desafortunado.
 *
 * CADA CORRIDA CON `--apply` DEJA SU REPORTE en `respaldos/media-backfill-<ts>.json`, con el valor
 * exacto que tenía cada ruta antes de tocarla. Ese archivo ES el mecanismo de reversión: sin él no
 * se puede volver atrás con precisión, así que no se borra hasta que la migración esté consolidada.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { buildInventory } from "../services/mediaBackfill/inventory";
import { rollbackReport, runBackfill, type BackfillReport } from "../services/mediaBackfill/runner";

dotenv.config();

const BACKUP_DIR = resolve(process.cwd(), "respaldos");

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function connect() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL no está definido.");
  await mongoose.connect(databaseUrl, { serverSelectionTimeoutMS: 20_000 });
}

async function doRollback(path: string) {
  const report = JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")) as BackfillReport;
  if (report.dryRun) throw new Error("Ese reporte es de un dry-run: no hay nada que revertir.");

  await connect();
  console.log(`\nRevirtiendo ${report.records.filter((r) => r.outcome === "migrada").length} ubicaciones de ${path}…`);
  // Se borran las carpetas subidas salvo que se pida conservarlas: dejarlas ocuparía espacio sin
  // que ningún documento las referencie.
  const result = await rollbackReport(report, { deleteUploads: !flag("keep-uploads") });
  console.log(`  restauradas ${result.restored}` + (result.failed ? `, ${result.failed} con error` : ""));
  await mongoose.disconnect();
}

async function main() {
  const rollbackPath = option("rollback");
  if (rollbackPath) return doRollback(rollbackPath);

  const bucket = (process.env.GCS_BUCKET_RESORT || "").trim();
  if (!bucket) throw new Error("GCS_BUCKET_RESORT no está definido.");

  const apply = flag("apply");
  const dryRun = !apply;
  const limitRaw = option("limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && !Number.isInteger(limit)) throw new Error("--limit espera un entero.");
  const collection = option("collection");

  await connect();

  // La lista de trabajo se materializa ANTES de tocar la primera imagen. Consecuencia asumida y
  // documentada: una corrida cubre la foto de un instante. Si alguien sube algo desde el panel
  // mientras corre, esa imagen no está en la lista y queda pendiente — volver a mirar el inventario
  // al terminar es parte del procedimiento, no un extra.
  const inventory = await buildInventory(bucket);

  console.log(`\nModo: ${dryRun ? "DRY-RUN (no escribe nada)" : "APPLY (escribe en la base y en el bucket)"}`);
  console.log(`Pendientes en total: ${inventory.pending.length}`);
  if (collection) console.log(`Restringido a la colección: ${collection}`);
  if (limit !== undefined) console.log(`Límite: ${limit}`);

  const report = await runBackfill(inventory.pending, {
    dryRun,
    limit,
    collection,
    onProgress: (record, index, total) => {
      const position = `[${String(index + 1).padStart(3)}/${total}]`;
      const where = `${record.collection}.${record.path}`.slice(0, 52).padEnd(52);
      if (record.outcome === "migrada" && !dryRun) {
        // Se muestran los dos números que le importan a un visitante —lo que baja un escritorio
        // (`orig.webp`) y lo que baja un teléfono (el candidato más chico)— y no la suma de todo lo
        // subido, que es almacenamiento y siempre pesa MÁS que el original.
        console.log(
          `${position} ok       ${where} ${kb(record.bytesBefore ?? 0)} → ${kb(record.bytesOrig ?? 0)} escritorio / ${kb(record.bytesSmallest ?? 0)} móvil`
        );
      } else if (record.outcome === "migrada") {
        console.log(`${position} migraría ${where} ${kb(record.bytesBefore ?? 0)}`);
      } else if (record.outcome === "omitida") {
        console.log(`${position} omitida  ${where} ${record.error}`);
      } else {
        console.log(`${position} FALLÓ    ${where} ${record.error}`);
      }
    },
  });

  console.log("\n── Resultado ────────────────────────────────────────────────────────────────────");
  console.log(`  procesadas ${report.migradas}   omitidas ${report.omitidas}   fallidas ${report.fallidas}`);
  if (dryRun) {
    console.log(`  peso actual de lo que migraría: ${mb(report.bytesBefore)}`);
    console.log("\n  Nada se escribió. Volvé a correrlo con --apply para migrar de verdad.");
  } else {
    const pct = (after: number) =>
      report.bytesBefore > 0 ? `${(((report.bytesBefore - after) / report.bytesBefore) * 100).toFixed(0)} %` : "—";
    console.log(`  lo que bajaba antes cualquier visitante: ${mb(report.bytesBefore)}`);
    console.log(`  lo que baja ahora un escritorio:         ${mb(report.bytesOrig)}  (-${pct(report.bytesOrig)})`);
    console.log(`  lo que baja ahora un teléfono:           ${mb(report.bytesSmallest)}  (-${pct(report.bytesSmallest)})`);
    console.log(`  almacenamiento añadido en el bucket:     ${mb(report.bytesStored)} (orig + variantes; los originales se conservan)`);

    await mkdir(BACKUP_DIR, { recursive: true });
    const file = resolve(BACKUP_DIR, `media-backfill-${report.startedAt.replace(/[:.]/g, "-")}.json`);
    await writeFile(file, JSON.stringify(report, null, 2), "utf8");
    console.log(`\n  Reporte y valores anteriores: ${file}`);
    console.log("  Para revertir:  npx ts-node src/scripts/mediaBackfill.ts --rollback <ese archivo>");
    console.log("\n  Acordate de mirar el inventario otra vez: una corrida cubre la foto de un instante.");
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("\n[mediaBackfill]", error instanceof Error ? error.message : error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
