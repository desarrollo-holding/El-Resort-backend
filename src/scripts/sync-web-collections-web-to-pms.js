/**
 * Copia las colecciones DE LA WEB del cluster WEB al cluster PMS, dejando la versión de la web
 * como la buena. Es el paso previo a reapuntar el backend de la web al cluster del PMS.
 *
 * ⚠ ALCANCE — LO MÁS IMPORTANTE DE ESTE ARCHIVO
 * Solo se tocan las 7 colecciones de la web listadas en COLECCIONES_WEB. Todo lo demás del
 * cluster PMS (comprasalons, checkins, comprobanteelectronicos, housekeepings, whatsappmessages,
 * menuitemglobals, actividads, users…) NO se lee, NO se escribe y NO se borra. Esa base es la
 * producción de un PMS con datos financieros: una colección de más en esta lista es una pérdida
 * de datos de otro sistema.
 *
 * ⚠ ES DESTRUCTIVO EN EL DESTINO
 * Cada colección se REEMPLAZA: se borra lo que hay en el PMS y se inserta lo de la web. Los
 * documentos que solo existían en el PMS desaparecen. Decisión explícita del dueño: la web manda.
 * El simulacro los lista uno a uno antes de que eso pase, y `--apply` vuelca antes las 7
 * colecciones del PMS a `respaldos/`, que está en .gitignore.
 *
 * `extras` queda FUERA por defecto: el PMS lo escribió más recientemente que la web
 * (2025-11-27 vs 2025-04-11) y tiene un documento que la web no tiene, así que ahí manda el PMS.
 * Para incluirlo, pasar --incluir-extras de forma consciente.
 *
 * USO
 *   node src/scripts/sync-web-collections-web-to-pms.js            # simulacro
 *   node src/scripts/sync-web-collections-web-to-pms.js --apply
 */

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const COLECCIONES_WEB = ["roomtypelocalspecs", "landingmedias", "areas", "condominios", "retiros", "claims"];
const EXTRAS = "extras";

const APPLY = process.argv.includes("--apply");
const INCLUIR_EXTRAS = process.argv.includes("--incluir-extras");
const log = (...a) => console.log(...a);

function uris() {
  const env = fs.readFileSync(path.join(__dirname, "../../.env"), "utf8");
  const web = env.match(/^DATABASE_URL=(.+)$/m);
  const pms = env.match(/^##DATABASE_URL=(.+)$/m);
  if (!web || !pms) throw new Error("No encuentro las dos cadenas en .env");
  return { web: web[1].trim(), pms: pms[1].trim() };
}

/** Un identificador legible para que el operador reconozca el documento que va a desaparecer. */
function describir(doc) {
  const n =
    doc.nombre ??
    doc.name ??
    doc.titulo ??
    doc.roomTypeID ??
    doc.slug ??
    (doc.seccion && String(doc.seccion)) ??
    null;
  const texto = typeof n === "object" ? JSON.stringify(n).slice(0, 60) : n;
  return `${String(doc._id)}  ${texto ?? "(sin nombre)"}`;
}

async function main() {
  const cols = INCLUIR_EXTRAS ? [...COLECCIONES_WEB, EXTRAS] : COLECCIONES_WEB;

  log(APPLY ? "⚠  MODO REAL: se reemplazan colecciones en el cluster PMS" : "ℹ  SIMULACRO: no se escribe nada");
  log(`   colecciones: ${cols.join(", ")}`);
  if (!INCLUIR_EXTRAS) log(`   ${EXTRAS}: FUERA (manda el PMS; usa --incluir-extras para forzarlo)`);

  const { web, pms } = uris();
  const cWeb = new MongoClient(web, { serverSelectionTimeoutMS: 20000 });
  const cPms = new MongoClient(pms, { serverSelectionTimeoutMS: 20000 });
  await Promise.all([cWeb.connect(), cPms.connect()]);
  const dbWeb = cWeb.db();
  const dbPms = cPms.db();

  log(`   origen  WEB: ${(web.match(/@([^:,]+)/) || [])[1]}`);
  log(`   destino PMS: ${(pms.match(/@([^:,]+)/) || [])[1]}`);

  try {
    const existePms = new Set((await dbPms.listCollections().toArray()).map((c) => c.name));

    // ── Respaldo del destino, antes de nada ──────────────────────────────────────────────────
    if (APPLY) {
      const carpeta = path.join(__dirname, "../../respaldos", `pre-sync-pms-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      fs.mkdirSync(carpeta, { recursive: true });
      const vol = {};
      for (const col of cols) vol[col] = existePms.has(col) ? await dbPms.collection(col).find({}).toArray() : [];
      fs.writeFileSync(path.join(carpeta, "pms-antes.json"), JSON.stringify(vol, null, 1), "utf8");
      const n = Object.values(vol).reduce((a, v) => a + v.length, 0);
      log(`\n  respaldo del PMS: ${n} documentos -> ${carpeta}`);
    }

    log("");
    let totalInsertados = 0;
    let totalBorrados = 0;

    for (const col of cols) {
      const docsWeb = await dbWeb.collection(col).find({}).toArray();
      const docsPms = existePms.has(col) ? await dbPms.collection(col).find({}).toArray() : [];

      const idsWeb = new Set(docsWeb.map((d) => String(d._id)));
      const soloPms = docsPms.filter((d) => !idsWeb.has(String(d._id)));

      log(`── ${col}`);
      log(`     web: ${docsWeb.length} docs   pms: ${docsPms.length} docs`);

      if (soloPms.length > 0) {
        log(`     ⚠ ${soloPms.length} documento(s) que SOLO existen en el PMS y ${APPLY ? "se han borrado" : "se van a borrar"}:`);
        for (const d of soloPms) log(`         ${describir(d)}`);
      }

      if (APPLY) {
        if (docsPms.length > 0) await dbPms.collection(col).deleteMany({});
        if (docsWeb.length > 0) await dbPms.collection(col).insertMany(docsWeb, { ordered: false });
      }

      totalBorrados += docsPms.length;
      totalInsertados += docsWeb.length;
      log("");
    }

    log("─── RESULTADO ───");
    log(`  ${APPLY ? "borrados" : "se borrarían"} del PMS : ${totalBorrados} documentos`);
    log(`  ${APPLY ? "insertados" : "se insertarían"}     : ${totalInsertados} documentos de la web`);
    log(`  colecciones del PMS intactas : todas menos las ${cols.length} listadas arriba`);
  } finally {
    await Promise.all([cWeb.close(), cPms.close()]);
  }

  if (!APPLY) log("\nNada se ejecutó. Repite con --apply cuando el simulacro se vea bien.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Fallo:", e);
    process.exit(1);
  });
