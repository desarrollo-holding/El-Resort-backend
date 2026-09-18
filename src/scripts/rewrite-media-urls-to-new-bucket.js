/**
 * Reapunta los medios de la web al bucket `elresort-web-media` y repara los assets que el bug de
 * `imageAssetSync` dejó pelados.
 *
 * QUÉ ARREGLA, POR CAMPO
 *   url         -> https://storage.googleapis.com/elresort-web-media/<clave>
 *   storageKey  -> la clave real del objeto. Sin ella, `diffRemovedImageAssets` identifica el asset
 *                  por su URL, y cualquier cambio futuro de formato de URL vuelve a disparar el
 *                  borrado masivo (ver imageAssetSync.ts:36-45). Restaurarla es lo que cierra esa puerta.
 *   variants[]  -> se reconstruye listando la carpeta del objeto en el bucket y leyendo el ancho y
 *                  alto REALES de la cabecera de cada .webp. Hoy están en [] por el mismo bug, y por
 *                  eso `toImageSource` devuelve srcSet vacío y el navegador se baja `orig` para un
 *                  hueco de 300px (o peor: se queda con una miniatura para un hero de 1920).
 *   width/height-> los del propio orig, leídos igual de la cabecera.
 *
 * SEGURIDAD
 *   - Escribe SOLO en el cluster de la WEB (la línea DATABASE_URL activa del .env), que es el que
 *     Railway lee de verdad. No toca el cluster del POS.
 *   - Solo las 7 colecciones de la web. El resto de la base es del otro sistema.
 *   - Antes de escribir nada vuelca esas 7 colecciones a un JSON de respaldo, para poder revertir.
 *   - Solo reescribe una URL si el objeto EXISTE en el bucket destino. Una URL rota que apunta al
 *     sitio viejo es diagnosticable; una que apunta a un objeto inexistente parece un archivo perdido.
 *   - No borra nada, en ningún bucket ni en ninguna colección.
 *
 * USO
 *   node src/scripts/rewrite-media-urls-to-new-bucket.js            # simulacro
 *   node src/scripts/rewrite-media-urls-to-new-bucket.js --apply    # ejecuta (hace respaldo antes)
 */

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { Storage } = require("@google-cloud/storage");
require("dotenv").config();

const DEST = "elresort-web-media";
const DEST_BASE = `https://storage.googleapis.com/${DEST}/`;
const PREFIJOS = ["fotosresort/", "videos/", "files/", "fuentes/"];
const COLECCIONES_WEB = ["roomtypelocalspecs", "landingmedias", "areas", "extras", "condominios", "retiros", "claims"];

const APPLY = process.argv.includes("--apply");
const log = (...a) => console.log(...a);

const PREFIJOS_URL = [
  "https://storage.googleapis.com/greendreams_bucket/",
  "http://storage.googleapis.com/greendreams_bucket/",
  "//storage.googleapis.com/greendreams_bucket/",
  "https://storage.googleapis.com/marketing_gallery/",
  "http://storage.googleapis.com/marketing_gallery/",
  "//storage.googleapis.com/marketing_gallery/",
  "https://elresort.pe/cms/",
  "http://elresort.pe/cms/",
  "//elresort.pe/cms/",
  "/cms/",
];

function claveDesdeUrl(valor) {
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  if (!s) return null;
  for (const p of PREFIJOS_URL) {
    if (!s.startsWith(p)) continue;
    const bruto = s.slice(p.length).split("?")[0].split("#")[0];
    if (!bruto) return null;
    let clave;
    try {
      clave = decodeURIComponent(bruto);
    } catch {
      clave = bruto;
    }
    if (!PREFIJOS.some((pre) => clave.startsWith(pre))) return null;
    return clave;
  }
  return null;
}

// ─── Dimensiones reales de un .webp, leyendo solo la cabecera ───────────────────────────────────

/**
 * Las variantes se llaman w480.webp, w1080.webp… pero el nombre es una promesa, no un dato: si el
 * original era más estrecho que la variante, el archivo real mide menos. Y `height` no está en el
 * nombre en absoluto, y el esquema del frontend lo exige (imageVariantSchema). Así que se lee de
 * la cabecera del contenedor RIFF, que cabe en los primeros 32 bytes.
 */
function dimensionesWebp(buf) {
  if (buf.length < 16 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);

  if (chunk === "VP8X" && buf.length >= 30) {
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  if (chunk === "VP8 " && buf.length >= 30) {
    // 20..22 es el sync code 0x9d 0x01 0x2a; el tamaño viene justo después, 14 bits por eje.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w, height: h };
  }
  if (chunk === "VP8L" && buf.length >= 25) {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return null;
}

async function leerDimensiones(file) {
  try {
    const trozos = [];
    for await (const t of file.createReadStream({ start: 0, end: 63 })) trozos.push(t);
    return dimensionesWebp(Buffer.concat(trozos));
  } catch {
    return null;
  }
}

// ─── Inventario del bucket destino, agrupado por carpeta ────────────────────────────────────────

async function inventario(storage) {
  const bucket = storage.bucket(DEST);
  const porClave = new Map(); // clave completa -> File
  for (const prefix of PREFIJOS) {
    let tok;
    do {
      const [files, next] = await bucket.getFiles({ prefix, maxResults: 1000, autoPaginate: false, pageToken: tok });
      for (const f of files) porClave.set(f.name, f);
      tok = next && next.pageToken;
    } while (tok);
  }
  return porClave;
}

/** Variantes que acompañan a un `<carpeta>/orig.webp`, con sus dimensiones reales. */
async function variantesDe(clave, porClave, cache) {
  if (!clave.endsWith("/orig.webp")) return null;
  if (cache.has(clave)) return cache.get(clave);

  const carpeta = clave.slice(0, -"orig.webp".length);
  const hermanos = [...porClave.keys()].filter((k) => k.startsWith(carpeta) && k !== clave && k.endsWith(".webp"));

  const variants = [];
  for (const h of hermanos) {
    const dim = await leerDimensiones(porClave.get(h));
    if (!dim) continue;
    variants.push({ width: dim.width, height: dim.height, format: "webp", url: `${DEST_BASE}${h}` });
  }
  variants.sort((a, b) => a.width - b.width);

  const dimOrig = await leerDimensiones(porClave.get(clave));
  const res = { variants, orig: dimOrig };
  cache.set(clave, res);
  return res;
}

// ─── Recorrido y reparación de documentos ───────────────────────────────────────────────────────

/**
 * Devuelve {ruta: valor} para `$set`. Repara tanto el string suelto (campos legacy) como el objeto
 * ImageAsset completo. Cuando el nodo es un objeto asset, se reparan sus tres campos a la vez: dejar
 * la url nueva con storageKey vacío mantendría vivo el fallo de identidad de imageAssetSync.
 */
async function repararNodo(nodo, ruta, ctx, cambios) {
  if (Array.isArray(nodo)) {
    for (let i = 0; i < nodo.length; i++) await repararNodo(nodo[i], `${ruta}.${i}`, ctx, cambios);
    return;
  }

  if (nodo && typeof nodo === "object") {
    if (nodo._bsontype || nodo instanceof Date) return;

    const clave = typeof nodo.url === "string" ? claveDesdeUrl(nodo.url) : null;
    if (clave && ctx.porClave.has(clave)) {
      cambios[`${ruta}.url`] = `${DEST_BASE}${clave}`;
      if (!nodo.storageKey) cambios[`${ruta}.storageKey`] = clave;

      const info = await variantesDe(clave, ctx.porClave, ctx.cache);
      if (info) {
        if (info.orig) {
          if (!nodo.width) cambios[`${ruta}.width`] = info.orig.width;
          if (!nodo.height) cambios[`${ruta}.height`] = info.orig.height;
        }
        if (info.variants.length > 0 && (!Array.isArray(nodo.variants) || nodo.variants.length === 0)) {
          cambios[`${ruta}.variants`] = info.variants;
          ctx.variantesReparadas++;
        } else if (Array.isArray(nodo.variants)) {
          // El asset ya traía sus variantes: no se reconstruyen, pero sus URLs también hay que
          // reapuntarlas. Antes se salía sin mirar dentro del array y se quedaban en el bucket
          // viejo, dejando la web atada a él aunque el `orig` ya estuviera migrado.
          nodo.variants.forEach((v, i) => {
            const kv = v && typeof v.url === "string" ? claveDesdeUrl(v.url) : null;
            if (kv && ctx.porClave.has(kv)) {
              cambios[`${ruta}.variants.${i}.url`] = `${DEST_BASE}${kv}`;
              ctx.variantesReapuntadas++;
            }
          });
        }
        if (clave.endsWith("/orig.webp") && !nodo.storagePrefix) {
          cambios[`${ruta}.storagePrefix`] = clave.slice(0, -"orig.webp".length);
        }
      }
      ctx.assetsReparados++;
      return; // no se baja dentro del asset: sus campos ya están tratados
    }

    for (const [k, v] of Object.entries(nodo)) {
      if (k === "_id") continue;
      await repararNodo(v, ruta ? `${ruta}.${k}` : k, ctx, cambios);
    }
    return;
  }

  if (typeof nodo === "string") {
    const clave = claveDesdeUrl(nodo);
    if (clave && ctx.porClave.has(clave)) {
      cambios[ruta] = `${DEST_BASE}${clave}`;
      ctx.stringsReparados++;
    }
  }
}

// ─── main ───────────────────────────────────────────────────────────────────────────────────────

function uriWeb() {
  const env = fs.readFileSync(path.join(__dirname, "../../.env"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error("No encuentro DATABASE_URL activa en .env");
  return m[1].trim();
}

async function respaldar(db, destino) {
  const salida = {};
  for (const col of COLECCIONES_WEB) {
    salida[col] = await db.collection(col).find({}).toArray();
  }
  fs.writeFileSync(destino, JSON.stringify(salida, null, 1), "utf8");
  const n = Object.values(salida).reduce((a, v) => a + v.length, 0);
  log(`  respaldo: ${n} documentos -> ${destino}`);
}

async function main() {
  log(APPLY ? "⚠  MODO REAL" : "ℹ  SIMULACRO: no se escribe nada");
  log(`   destino: ${DEST}`);

  const uri = uriWeb();
  log(`   cluster: ${(uri.match(/@([^:,]+)/) || [])[1]} (el que lee Railway)`);

  const storage = new Storage({ credentials: JSON.parse(process.env.GOOGLE_CLOUD_STORAGE_CREDENTIALS) });
  log("\n[1/3] Inventariando el bucket destino");
  const porClave = await inventario(storage);
  log(`  ${porClave.size} objetos disponibles`);

  const cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await cliente.connect();
  const db = cliente.db();

  try {
    if (APPLY) {
      log("\n[2/3] Respaldo previo");
      // Misma convención que `npm run media:respaldo`: volcado completo bajo `respaldos/`, que
      // está en .gitignore. Son cientos de KB de datos de producción y son la red de seguridad de
      // quien corre el script, no código que deba versionarse.
      const carpeta = path.join(__dirname, "../../respaldos", `pre-rewrite-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      fs.mkdirSync(carpeta, { recursive: true });
      await respaldar(db, path.join(carpeta, "collections.json"));
    } else {
      log("\n[2/3] Respaldo previo (se hará al aplicar)");
    }

    log("\n[3/3] Reparando documentos");
    const ctx = { porClave, cache: new Map(), assetsReparados: 0, stringsReparados: 0, variantesReparadas: 0, variantesReapuntadas: 0 };
    let docsTocados = 0;
    let camposTocados = 0;
    const muestras = [];

    for (const col of COLECCIONES_WEB) {
      const coll = db.collection(col);
      let n = 0;
      const cursor = coll.find({});
      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        const cambios = {};
        for (const [k, v] of Object.entries(doc)) {
          if (k === "_id") continue;
          await repararNodo(v, k, ctx, cambios);
        }
        const rutas = Object.keys(cambios);
        if (rutas.length === 0) continue;

        if (muestras.length < 5) {
          const r = rutas.find((x) => x.endsWith(".url")) || rutas[0];
          muestras.push(`${col}/${doc._id}\n          ${r}\n          -> ${String(cambios[r]).slice(0, 96)}`);
        }
        if (APPLY) await coll.updateOne({ _id: doc._id }, { $set: cambios });
        docsTocados++;
        camposTocados += rutas.length;
        n++;
      }
      if (n > 0) log(`  ${col}: ${n} documentos`);
    }

    log("\n─── RESULTADO ───");
    log(`  ${APPLY ? "actualizados" : "se actualizarían"}: ${docsTocados} documentos, ${camposTocados} campos`);
    log(`  assets con url+storageKey reparados : ${ctx.assetsReparados}`);
    log(`  campos string (legacy) reapuntados  : ${ctx.stringsReparados}`);
    log(`  variants[] reconstruidos            : ${ctx.variantesReparadas}`);
    log(`  URLs de variantes reapuntadas       : ${ctx.variantesReapuntadas}`);
    if (muestras.length) {
      log("\n  Muestra:");
      for (const m of muestras) log(`      ${m}`);
    }
  } finally {
    await cliente.close();
  }

  if (!APPLY) log("\nNada se ejecutó. Repite con --apply cuando el simulacro se vea bien.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Fallo:", e);
    process.exit(1);
  });
