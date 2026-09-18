/**
 * Congela en Mongo las comodidades que hoy llegan en vivo de Cloudbeds (`roomTypeFeatures`),
 * guardándolas en el campo local `beneficiosTexto` de cada propiedad.
 *
 * POR QUÉ
 * 11 de las 16 propiedades activas no tienen `beneficios` cargados desde el panel, así que su
 * ficha muestra hoy el respaldo de Cloudbeds. Al quitar la integración ese respaldo desaparece y
 * esas fichas se quedarían sin el bloque de comodidades. Este script lo mueve a la base ANTES de
 * cortar, de modo que el visitante siga viendo exactamente lo mismo.
 *
 * NO sustituye a `beneficios`: ese lleva icono y los dos idiomas y se sigue cargando desde el
 * panel. Cuando una propiedad tenga `beneficios`, `beneficiosTexto` deja de usarse solo.
 *
 * LIMPIEZA
 * Las 66 cadenas del snapshot son ~35 conceptos reales: vienen con espacios finales, tildes
 * inconsistentes y singular/plural ("Frigobar " y "Frigobar", "Hervidor electrico" y
 * "Hervidor eléctrico", "Puff"/"Puffs"). Se deduplica por una clave normalizada (sin tildes, sin
 * espacios, minúsculas, sin plural) y se conserva la variante mejor escrita: la que lleva tildes
 * y no tiene espacios sobrantes. Migrarlas crudas sería heredar la basura al panel.
 *
 * FUENTE: el snapshot ya commiteado, no la API. La integración puede estar ya caída.
 *
 * USO
 *   node src/scripts/freeze-cloudbeds-features.js            # simulacro
 *   node src/scripts/freeze-cloudbeds-features.js --apply
 */

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const APPLY = process.argv.includes("--apply");
const log = (...a) => console.log(...a);

/** Clave de comparación: sin tildes, sin espacios, minúsculas y sin plural final. */
const claveNorm = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");

/** Entre dos variantes del mismo concepto gana la que tiene tildes y no tiene espacios sobrantes. */
const mejorVariante = (a, b) => {
  const puntua = (s) => {
    let p = 0;
    if (s !== s.trim()) p -= 2; // espacios sobrantes
    if (/[áéíóúñÁÉÍÓÚÑ]/.test(s)) p += 2; // acentuada correctamente
    if (/^[a-záéíóúñ]/.test(s)) p -= 1; // empieza en minúscula
    return p;
  };
  return puntua(b) > puntua(a) ? b : a;
};

function limpiar(features) {
  const porClave = new Map();
  for (const bruto of features || []) {
    const texto = String(bruto || "").trim();
    if (!texto) continue;
    const k = claveNorm(texto);
    if (!k) continue;
    porClave.set(k, porClave.has(k) ? mejorVariante(porClave.get(k), texto) : texto);
  }
  return [...porClave.values()].sort((a, b) => a.localeCompare(b, "es"));
}

function cargarSnapshot() {
  const base = path.join(__dirname, "../../respaldos");
  const dirs = fs
    .readdirSync(base)
    .filter((d) => d.startsWith("cloudbeds-snapshot-"))
    .sort();
  if (dirs.length === 0) throw new Error("No hay ningún cloudbeds-snapshot-* en respaldos/");
  const f = path.join(base, dirs[dirs.length - 1], "catalogo.json");
  log(`  snapshot: ${dirs[dirs.length - 1]}`);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function uris() {
  const env = fs.readFileSync(path.join(__dirname, "../../.env"), "utf8");
  const web = env.match(/^DATABASE_URL=(.+)$/m);
  const pms = env.match(/^##DATABASE_URL=(.+)$/m);
  const out = [];
  if (pms) out.push(["PMS", pms[1].trim()]);
  if (web) out.push(["WEB", web[1].trim()]);
  return out;
}

async function main() {
  log(APPLY ? "⚠  MODO REAL" : "ℹ  SIMULACRO: no se escribe nada");

  const snap = cargarSnapshot();
  const porRoomType = new Map();
  for (const t of snap.roomTypes || []) {
    const limpias = limpiar(t.roomTypeFeatures);
    if (t.roomTypeID) porRoomType.set(String(t.roomTypeID), limpias);
  }

  const brutas = new Set();
  for (const t of snap.roomTypes || []) (t.roomTypeFeatures || []).forEach((f) => brutas.add(String(f)));
  const limpiasGlobal = new Set();
  for (const v of porRoomType.values()) v.forEach((f) => limpiasGlobal.add(f));
  log(`  features en el snapshot: ${brutas.size} distintas -> ${limpiasGlobal.size} tras limpiar\n`);

  // Se escribe en LOS DOS clusters: hoy están sincronizados y dejarlos bifurcarse es justo el
  // problema que ya costó dos incidentes.
  for (const [nombre, uri] of uris()) {
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
    await c.connect();
    const col = c.db().collection("roomtypelocalspecs");
    const host = (uri.match(/@([^:,]+)/) || [])[1];
    log(`=== ${nombre} (${host})`);

    const docs = await col.find({}).toArray();
    let escritas = 0;
    let sinSnapshot = [];
    let yaTenian = 0;

    for (const d of docs) {
      const id = String(d.roomTypeID ?? "");
      const features = porRoomType.get(id);
      if (!features || features.length === 0) {
        sinSnapshot.push(id);
        continue;
      }
      if (Array.isArray(d.beneficiosTexto) && d.beneficiosTexto.length > 0) {
        yaTenian++;
        continue;
      }
      if (APPLY) await col.updateOne({ _id: d._id }, { $set: { beneficiosTexto: features } });
      escritas++;
    }

    log(`   ${APPLY ? "escritas" : "se escribirían"}: ${escritas} propiedades`);
    if (yaTenian) log(`   ya tenían beneficiosTexto: ${yaTenian}`);
    if (sinSnapshot.length) log(`   sin features en el snapshot: ${sinSnapshot.join(", ")}`);
    log("");
    await c.close();
  }

  if (!APPLY) log("Nada se ejecutó. Repite con --apply.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Fallo:", e.message);
    process.exit(1);
  });
