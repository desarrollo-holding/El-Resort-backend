/**
 * Respaldo completo de colecciones, en EJSON. SOLO LEE de la base.
 *
 *   npx ts-node src/scripts/respaldoColecciones.ts                          las 6 del backfill
 *   npx ts-node src/scripts/respaldoColecciones.ts --collection landingmedias
 *   npx ts-node src/scripts/respaldoColecciones.ts --restaurar respaldos/<carpeta> --apply
 *
 * POR QUÉ EXISTE SI `mediaBackfill --rollback` YA REVIERTE
 * Porque son dos redes distintas y fallan de formas distintas. El reporte del backfill es preciso
 * —guarda el valor previo de cada RUTA que tocó— pero solo cubre lo que ese script se propuso
 * cambiar, y depende de que su propio recorrido haya sido correcto. Esto guarda el DOCUMENTO
 * ENTERO tal como estaba, así que sirve aunque el backfill haya escrito donde no debía, aunque el
 * reporte salga incompleto o aunque el fallo esté en el propio `--rollback`.
 *
 * No reemplaza al `--rollback`, que sigue siendo la reversión de primera elección: revierte solo
 * las rutas migradas y no pisa nada que se haya editado desde el panel mientras tanto. Esto es el
 * paso siguiente, para cuando aquello no alcance.
 *
 * SOBRE EJSON Y POR QUÉ NO `JSON.stringify`
 * `JSON.stringify` convierte un `ObjectId` en su cadena hexadecimal y un `Date` en un texto ISO.
 * Al restaurar, esos valores volverían como STRINGS y los documentos quedarían con tipos
 * distintos de los originales: las consultas por `_id` dejarían de encontrarlos y cualquier
 * comparación de fechas empezaría a fallar. EJSON conserva el tipo (`{"$oid": …}`, `{"$date": …}`)
 * y `EJSON.parse` lo devuelve idéntico, que es la única forma de que "restaurar" signifique de
 * verdad dejar la base como estaba.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { EJSON } from "bson";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { COLLECTION_RULES } from "../services/mediaBackfill/collections";

dotenv.config();

const BACKUP_DIR = resolve(process.cwd(), "respaldos");

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

function db() {
  const conexion = mongoose.connection.db;
  if (!conexion) throw new Error("No hay conexión a la base.");
  return conexion;
}

/** Las mismas colecciones que toca el backfill: respaldar otras sería ruido. */
const coleccionesPorDefecto = (): string[] => COLLECTION_RULES.map((r) => r.collection);

async function respaldar(colecciones: string[]) {
  const marca = new Date().toISOString().replace(/[:.]/g, "-");
  const destino = join(BACKUP_DIR, `pre-backfill-${marca}`);
  await mkdir(destino, { recursive: true });

  const existentes = new Set((await db().listCollections().toArray()).map((c) => c.name));

  console.log(`\nRespaldando en ${destino}\n`);
  let totalDocs = 0;

  for (const nombre of colecciones) {
    if (!existentes.has(nombre)) {
      console.log(`  ${nombre.padEnd(22)} (no existe en esta base, se omite)`);
      continue;
    }
    const docs = await db().collection(nombre).find({}).toArray();
    // `EJSON.stringify` con `relaxed: false` fuerza el modo extendido para TODOS los tipos, no
    // solo los que no tienen equivalente en JSON. Es más feo de leer y es exactamente lo que se
    // quiere de un respaldo: que restaurar devuelva los mismos tipos, no unos parecidos.
    await writeFile(join(destino, `${nombre}.json`), EJSON.stringify(docs, undefined, 2, { relaxed: false }), "utf8");
    console.log(`  ${nombre.padEnd(22)} ${String(docs.length).padStart(5)} documentos`);
    totalDocs += docs.length;
  }

  console.log(`\n  ${totalDocs} documentos en total.`);
  console.log(`\n  Para restaurar:`);
  console.log(`    npx ts-node src/scripts/respaldoColecciones.ts --restaurar ${destino.replace(/\\/g, "/")} --apply\n`);
  return destino;
}

async function restaurar(carpeta: string, apply: boolean) {
  const ruta = resolve(process.cwd(), carpeta);
  const archivos = (await readdir(ruta)).filter((f) => f.endsWith(".json"));
  if (!archivos.length) throw new Error(`No hay ningún .json en ${ruta}`);

  console.log(`\n${apply ? "RESTAURANDO" : "SIMULACRO (sin --apply no se escribe nada)"} desde ${ruta}\n`);

  for (const archivo of archivos) {
    const nombre = archivo.replace(/\.json$/, "");
    const docs = EJSON.parse(await readFile(join(ruta, archivo), "utf8")) as { _id: unknown }[];

    if (!apply) {
      console.log(`  ${nombre.padEnd(22)} ${String(docs.length).padStart(5)} documentos se reemplazarían`);
      continue;
    }

    let restaurados = 0;
    for (const doc of docs) {
      // `replaceOne` y no `updateOne` con `$set`: el documento tiene que quedar EXACTAMENTE como
      // estaba. Un `$set` dejaría vivos los campos que el backfill agregó (`variants`,
      // `storagePrefix`…) y el resultado no sería el original sino una mezcla.
      //
      // Sin `upsert`: si un documento fue borrado después del respaldo, resucitarlo acá sería una
      // decisión que este script no puede tomar por su cuenta. Se informa y se deja al humano.
      const resultado = await db().collection(nombre).replaceOne({ _id: doc._id as never }, doc);
      if (resultado.matchedCount > 0) restaurados += 1;
    }
    const perdidos = docs.length - restaurados;
    console.log(
      `  ${nombre.padEnd(22)} ${String(restaurados).padStart(5)} restaurados` +
        (perdidos ? `  (${perdidos} ya no existen en la base: NO se recrearon)` : ""),
    );
  }
  console.log("");
}

async function main() {
  const carpetaRestaurar = option("restaurar");
  await connect();

  try {
    if (carpetaRestaurar) {
      await restaurar(carpetaRestaurar, flag("apply"));
    } else {
      const unaColeccion = option("collection");
      await respaldar(unaColeccion ? [unaColeccion] : coleccionesPorDefecto());
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("\n[respaldo] falló:", error?.message || error);
  process.exitCode = 1;
});
