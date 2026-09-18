/**
 * Congela en disco todo lo que CloudBeds sabe del catálogo, ANTES de quitar la integración.
 *
 * POR QUÉ EXISTE
 * El sitio va a dejar de hablar con CloudBeds. Casi todos los campos que pinta ya viven en Mongo
 * (nombre, descripción, maxGuests, precio, dormitorios, baños, fotos), pero quedan dos que hoy
 * solo llegan de CloudBeds y se perderían sin remedio:
 *
 *   roomTypeFeatures  -> el respaldo de `beneficios`. 13 de 18 propiedades no tienen beneficios
 *                        locales, así que hoy muestran los de CloudBeds.
 *   roomTypePhotos    -> el respaldo de las fotos. Ya no hace falta (todas tienen portada local)
 *                        pero se guarda igual: cuesta cero y es irrecuperable.
 *
 * Esto NO escribe en Mongo ni modifica nada en CloudBeds: solo hace GET y vuelca un JSON.
 * Es el paso previo a decidir qué se migra a campos locales y qué se descarta.
 *
 * USO
 *   node src/scripts/snapshot-cloudbeds-catalog.js
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config();

const BASE = (process.env.CLOUDBEDS_BASE_URL || "").replace(/\/$/, "");
const KEY = process.env.CLOUDBEDS_API_KEY;
const MODE = process.env.CLOUDBEDS_AUTH_MODE || "bearer";

const headers = () => (MODE === "bearer" ? { Authorization: `Bearer ${KEY}` } : { "x-api-key": KEY });

async function get(endpoint, params = {}) {
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: headers() });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${endpoint} -> ${r.status}: ${texto.slice(0, 160)}`);
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`${endpoint} -> respuesta no JSON: ${texto.slice(0, 160)}`);
  }
}

async function main() {
  if (!BASE || !KEY) throw new Error("Faltan CLOUDBEDS_BASE_URL / CLOUDBEDS_API_KEY en .env");
  console.log(`Volcando catálogo desde ${BASE}\n`);

  const salida = { tomadoEl: new Date().toISOString(), base: BASE, roomTypes: [], crudo: {} };

  // getRoomTypes trae nombre, descripción, features, fotos y capacidad de cada tipo.
  const rt = await get("getRoomTypes");
  salida.crudo.getRoomTypes = rt;
  const tipos = Array.isArray(rt.data) ? rt.data : [];
  console.log(`getRoomTypes: ${tipos.length} tipos`);

  for (const t of tipos) {
    salida.roomTypes.push({
      roomTypeID: String(t.roomTypeID ?? ""),
      roomTypeName: t.roomTypeName ?? null,
      roomTypeDescription: t.roomTypeDescription ?? null,
      maxGuests: t.maxGuests ?? null,
      roomTypeFeatures: t.roomTypeFeatures ?? null,
      roomTypePhotos: t.roomTypePhotos ?? null,
      roomsAvailable: t.roomsAvailable ?? null,
      propertyID: t.propertyID ?? null,
    });
  }

  // Inventario: qué habitaciones físicas hay por tipo. Es lo que alimenta la búsqueda por fechas.
  try {
    const rooms = await get("getRooms", { includeRoomRelations: 0, pageSize: 200 });
    salida.crudo.getRooms = rooms;
    const props = Array.isArray(rooms.data) ? rooms.data : [];
    const n = props.reduce((a, p) => a + (Array.isArray(p.rooms) ? p.rooms.length : 0), 0);
    console.log(`getRooms: ${n} habitaciones físicas`);
  } catch (e) {
    console.log(`getRooms: no se pudo (${e.message.slice(0, 80)})`);
  }

  const carpeta = path.join(__dirname, "../../respaldos", `cloudbeds-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, "catalogo.json");
  fs.writeFileSync(destino, JSON.stringify(salida, null, 1), "utf8");

  console.log(`\nGuardado en ${destino}`);
  console.log("\nRESUMEN POR PROPIEDAD (lo que solo existe en CloudBeds):");
  console.log("  roomTypeID".padEnd(16) + "features".padStart(10) + "fotos".padStart(8) + "  nombre");
  for (const t of salida.roomTypes) {
    const f = Array.isArray(t.roomTypeFeatures) ? t.roomTypeFeatures.length : 0;
    const p = Array.isArray(t.roomTypePhotos) ? t.roomTypePhotos.length : 0;
    console.log("  " + t.roomTypeID.padEnd(14) + String(f).padStart(10) + String(p).padStart(8) + "  " + String(t.roomTypeName).slice(0, 40));
  }

  const conFeatures = salida.roomTypes.filter((t) => Array.isArray(t.roomTypeFeatures) && t.roomTypeFeatures.length > 0);
  if (conFeatures.length > 0) {
    const todas = new Set();
    for (const t of conFeatures) t.roomTypeFeatures.forEach((f) => todas.add(String(f)));
    console.log(`\nFEATURES DISTINTAS EN TODO EL CATÁLOGO (${todas.size}):`);
    for (const f of [...todas].sort()) console.log("   · " + f);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Fallo:", e.message);
    process.exit(1);
  });
