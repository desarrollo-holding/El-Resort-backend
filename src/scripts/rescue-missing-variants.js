/**
 * Completa las carpetas de `elresort-web-media` a las que les faltan variantes.
 *
 * POR QUÉ HACE FALTA
 * La consolidación anterior copió solo las claves que Mongo referenciaba. Pero el bug de
 * `imageAssetSync` dejó `variants: []` en los assets que dañó, así que las variantes (w480, w768,
 * w1080…) no estaban referenciadas por nadie: no se copiaron y siguen en el soft-delete de
 * `marketing_gallery`. El resultado es una carpeta con solo `orig.webp`, que funciona pero obliga
 * al navegador a bajarse el original para cualquier hueco — es la otra mitad de los heroes borrosos.
 *
 * Este script no mira Mongo. Recorre el bucket destino, y para cada carpeta de variantes
 * (`fotosresort/<epoch>-<uuid>/`) busca los hermanos que falten, vivos o en soft-delete, en
 * `greendreams_bucket` y `marketing_gallery`, y los trae.
 *
 * No borra nada. Si un hermano hay que restaurarlo, se restaura en su bucket de origen y se deja ahí.
 *
 * USO
 *   node src/scripts/rescue-missing-variants.js            # simulacro
 *   node src/scripts/rescue-missing-variants.js --apply
 */

const { Storage } = require("@google-cloud/storage");
require("dotenv").config();

const DEST = "elresort-web-media";
const FUENTES = ["greendreams_bucket", "marketing_gallery"];
const PREFIJO = "fotosresort/";
/** Solo carpetas del pipeline de variantes: `<epoch>-<uuid>/`. Los archivos legacy planos
 *  (`1788382524926_textura.webp`) no tienen variantes y no hay nada que completar en ellos. */
const RE_CARPETA = /^fotosresort\/\d+-[0-9a-f-]{36}\//;

const APPLY = process.argv.includes("--apply");
const log = (...a) => console.log(...a);

async function listar(bucket, opciones) {
  const out = new Map();
  let tok;
  do {
    const [files, next] = await bucket.getFiles({
      prefix: PREFIJO,
      maxResults: 1000,
      autoPaginate: false,
      pageToken: tok,
      ...opciones,
    });
    for (const f of files) if (!out.has(f.name)) out.set(f.name, f.metadata.generation);
    tok = next && next.pageToken;
  } while (tok);
  return out;
}

function agruparPorCarpeta(claves) {
  const carpetas = new Map();
  for (const k of claves) {
    const m = k.match(RE_CARPETA);
    if (!m) continue;
    if (!carpetas.has(m[0])) carpetas.set(m[0], new Set());
    carpetas.get(m[0]).add(k);
  }
  return carpetas;
}

async function main() {
  log(APPLY ? "⚠  MODO REAL" : "ℹ  SIMULACRO: no se escribe nada");

  const storage = new Storage({ credentials: JSON.parse(process.env.GOOGLE_CLOUD_STORAGE_CREDENTIALS) });
  const dest = storage.bucket(DEST);

  log("\n[1/2] Inventariando");
  const destClaves = await listar(dest, {});
  const destCarpetas = agruparPorCarpeta(destClaves.keys());
  log(`  ${DEST}: ${destCarpetas.size} carpetas de variantes`);

  const fuentes = {};
  for (const b of FUENTES) {
    const bucket = storage.bucket(b);
    const vivos = await listar(bucket, {});
    let borrados = new Map();
    try {
      borrados = await listar(bucket, { softDeleted: true });
    } catch (e) {
      log(`  ⚠ ${b}: soft-delete no listable (${e.message.slice(0, 50)})`);
    }
    fuentes[b] = { bucket, vivos, borrados };
    log(`  ${b}: ${vivos.size} vivos, ${borrados.size} soft-deleted`);
  }

  log("\n[2/2] Completando carpetas");
  let carpetasTocadas = 0;
  let copiados = 0;
  let rescatados = 0;
  const fallos = [];

  for (const [carpeta, presentes] of destCarpetas) {
    // Todo hermano conocido de esta carpeta, mirando las cuatro fuentes.
    const candidatos = new Set();
    for (const b of FUENTES) {
      for (const mapa of [fuentes[b].vivos, fuentes[b].borrados]) {
        for (const k of mapa.keys()) if (k.startsWith(carpeta)) candidatos.add(k);
      }
    }

    const faltan = [...candidatos].filter((k) => !presentes.has(k));
    if (faltan.length === 0) continue;
    carpetasTocadas++;

    for (const clave of faltan) {
      const vivoEn = FUENTES.find((b) => fuentes[b].vivos.has(clave));
      const borradoEn = vivoEn ? null : FUENTES.find((b) => fuentes[b].borrados.has(clave));
      const origenBucket = vivoEn || borradoEn;
      if (!origenBucket) continue;

      if (!APPLY) {
        if (vivoEn) copiados++;
        else rescatados++;
        continue;
      }

      try {
        const origen = fuentes[origenBucket].bucket.file(clave);
        if (borradoEn) {
          await origen.restore({ generation: fuentes[borradoEn].borrados.get(clave) });
          rescatados++;
        } else {
          copiados++;
        }
        await origen.copy(dest.file(clave));
      } catch (e) {
        fallos.push(`${clave}: ${e.message.slice(0, 70)}`);
      }
    }
  }

  log("\n─── RESULTADO ───");
  log(`  carpetas ${APPLY ? "completadas" : "a completar"}: ${carpetasTocadas}`);
  log(`  variantes copiadas de un bucket vivo : ${copiados}`);
  log(`  variantes RESCATADAS de soft-delete  : ${rescatados}`);
  if (fallos.length) {
    log(`  ⚠ fallos: ${fallos.length}`);
    for (const f of fallos.slice(0, 15)) log(`      ${f}`);
  }

  if (!APPLY) log("\nNada se ejecutó. Repite con --apply.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Fallo:", e);
    process.exit(1);
  });
