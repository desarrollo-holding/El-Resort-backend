/**
 * Consolida TODOS los medios de la web en el bucket nuevo `elresort-web-media`.
 *
 * NO TOCA NINGUNA BASE DE DATOS. Lee Mongo en solo lectura (para saber qué objetos referencia la
 * web) y a partir de ahí solo trabaja contra GCS. No escribe en Mongo, no borra nada en ningún
 * bucket. Es puramente aditivo: al terminar, el sitio sigue sirviendo desde las URLs de siempre,
 * porque nadie apunta todavía al bucket nuevo. La reescritura de URLs es un paso posterior y aparte.
 *
 * POR QUÉ LEE LOS DOS CLUSTERS
 * Hay dos bases Mongo vivas con la misma base `extras_resort`: la web escribe en el cluster que el
 * .env llama DESARROLLO (`r9rr0m`, al que Railway apunta de verdad) y el POS escribe en el que
 * llama PRODUCCION (`zh3if1`). Como todavía no está decidido cuál será el definitivo, el set de
 * claves es la UNIÓN de lo que referencian los dos: así, se decida lo que se decida, los objetos
 * ya están en el bucket nuevo y la reescritura de URLs no depende de esta migración.
 *
 * DE DÓNDE SALE CADA OBJETO, en este orden:
 *   1. ya está en elresort-web-media          -> no se hace nada
 *   2. vivo en greendreams_bucket             -> copia server-side
 *   3. vivo en marketing_gallery              -> copia server-side
 *   4. soft-deleted en marketing_gallery      -> restore + copia
 *   5. soft-deleted en greendreams_bucket     -> restore + copia
 *   6. en ningún sitio                        -> se reporta como irrecuperable
 *
 * El paso 4 es el que rescata las ~183 fotos que se borraron la noche del 17/09. El soft delete de
 * marketing_gallery es de 90 días y expira a mediados de diciembre; después ya no habría rescate.
 * OJO: `restore()` vuelve a crear el objeto en su bucket de origen (es una escritura en
 * marketing_gallery). Es aditivo —recupera algo que se borró por accidente— y no se vuelve a
 * borrar después: se deja restaurado.
 *
 * Las URLs de Supabase (`lzckuzhzecmuoqmpohad.supabase.co`) y de WordPress (`/wp-content/`) se
 * ignoran a propósito: ese proyecto Supabase ya no existe y los assets de WP son de otro sitio.
 * No hay nada que copiar desde ahí.
 *
 * USO
 *   node src/scripts/migrate-media-to-elresort-web-media.js            # simulacro
 *   node src/scripts/migrate-media-to-elresort-web-media.js --apply    # ejecuta
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();

const DEST = 'elresort-web-media';
const FUENTES = ['greendreams_bucket', 'marketing_gallery'];
/** Carpetas de la web. El resto del bucket (bills/, comprobantes/, whatsapp-inbox/…) es de otro
 *  sistema y no se mira siquiera: meter eso en un bucket público sería una fuga de datos. */
const PREFIJOS = ['fotosresort/', 'videos/', 'files/', 'fuentes/'];

const COLECCIONES_WEB = [
  'roomtypelocalspecs',
  'landingmedias',
  'areas',
  'extras',
  'condominios',
  'retiros',
  'claims',
];

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log(...a);

/** Prefijos de URL de los que se puede extraer una clave de objeto de NUESTROS buckets. */
const PREFIJOS_URL = [
  ...FUENTES.flatMap((b) => [
    `https://storage.googleapis.com/${b}/`,
    `http://storage.googleapis.com/${b}/`,
    `//storage.googleapis.com/${b}/`,
  ]),
  `https://storage.googleapis.com/${DEST}/`,
  'https://elresort.pe/cms/',
  'http://elresort.pe/cms/',
  '//elresort.pe/cms/',
  '/cms/',
];

function claveDesdeUrl(valor) {
  if (typeof valor !== 'string') return null;
  const s = valor.trim();
  if (!s) return null;
  for (const p of PREFIJOS_URL) {
    if (!s.startsWith(p)) continue;
    const bruto = s.slice(p.length).split('?')[0].split('#')[0];
    if (!bruto) return null;
    let clave;
    try {
      clave = decodeURIComponent(bruto);
    } catch {
      clave = bruto;
    }
    // Solo carpetas de la web: si la URL apunta a comprobantes/ o bills/, no es nuestra.
    if (!PREFIJOS.some((pre) => clave.startsWith(pre))) return null;
    return clave;
  }
  return null;
}

/** Recorre el documento entero: así no se escapa ningún campo que nadie listó. */
function recorrer(nodo, visitar) {
  if (Array.isArray(nodo)) {
    for (const v of nodo) recorrer(v, visitar);
    return;
  }
  if (nodo && typeof nodo === 'object') {
    if (nodo._bsontype || nodo instanceof Date) return;
    for (const v of Object.values(nodo)) recorrer(v, visitar);
    return;
  }
  visitar(nodo);
}

// ─── 1. Claves que la web referencia, leyendo los dos clusters ──────────────────────────────────

function leerUris() {
  const env = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8');
  const uno = (re) => {
    const m = env.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    WEB: uno(/^DATABASE_URL=(.+)$/m),
    POS: uno(/^##DATABASE_URL=(.+)$/m),
  };
}

async function recolectarClaves() {
  const uris = leerUris();
  const claves = new Set();

  log('\n[1/3] Leyendo referencias de medios (SOLO LECTURA)');

  for (const [nombre, uri] of Object.entries(uris)) {
    if (!uri) {
      log(`  ⚠ cluster ${nombre}: no encontrado en .env, se omite`);
      continue;
    }
    const host = (uri.match(/@([^:,]+)/) || [])[1] || '?';
    const cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
    let antes = claves.size;
    try {
      await cliente.connect();
      const db = cliente.db();
      const existentes = new Set((await db.listCollections().toArray()).map((c) => c.name));
      for (const col of COLECCIONES_WEB) {
        if (!existentes.has(col)) continue;
        const cursor = db.collection(col).find({});
        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          recorrer(doc, (v) => {
            const k = claveDesdeUrl(v);
            if (k) claves.add(k);
          });
        }
      }
      log(`  ${nombre.padEnd(4)} (${host}): +${claves.size - antes} claves nuevas`);
    } catch (e) {
      log(`  ⚠ cluster ${nombre}: ${e.message.slice(0, 90)}`);
    } finally {
      await cliente.close().catch(() => {});
    }
  }

  log(`  → ${claves.size} objetos distintos que la web necesita`);
  return claves;
}

// ─── 2. Inventarios de GCS ──────────────────────────────────────────────────────────────────────

function getStorage() {
  const raw = process.env.GOOGLE_CLOUD_STORAGE_CREDENTIALS;
  if (!raw) throw new Error('Falta GOOGLE_CLOUD_STORAGE_CREDENTIALS');
  return new Storage({ credentials: JSON.parse(raw) });
}

async function listar(bucket, opciones) {
  const nombres = new Map();
  for (const prefix of PREFIJOS) {
    let pageToken;
    do {
      const [files, next] = await bucket.getFiles({
        prefix,
        maxResults: 1000,
        autoPaginate: false,
        pageToken,
        ...opciones,
      });
      for (const f of files) {
        // Con softDeleted puede haber varias generaciones por clave: nos vale cualquiera viva.
        if (!nombres.has(f.name)) nombres.set(f.name, f.metadata.generation);
      }
      pageToken = next && next.pageToken;
    } while (pageToken);
  }
  return nombres;
}

async function construirInventarios(storage) {
  log('\n[2/3] Inventariando buckets');
  const inv = {};

  inv[DEST] = await listar(storage.bucket(DEST), {});
  log(`  ${DEST.padEnd(20)} vivos: ${inv[DEST].size}`);

  for (const b of FUENTES) {
    const bucket = storage.bucket(b);
    const vivos = await listar(bucket, {});
    let borrados = new Map();
    try {
      borrados = await listar(bucket, { softDeleted: true });
    } catch (e) {
      log(`  ⚠ ${b}: no se pudo listar soft-deleted (${e.message.slice(0, 50)})`);
    }
    inv[b] = { vivos, borrados };
    log(`  ${b.padEnd(20)} vivos: ${String(vivos.size).padStart(5)}   soft-deleted: ${borrados.size}`);
  }

  return inv;
}

// ─── 3. Asegurar cada clave en el bucket destino ────────────────────────────────────────────────

async function asegurar(storage, claves, inv) {
  log(`\n[3/3] Asegurando ${claves.size} objetos en ${DEST}`);

  const dest = storage.bucket(DEST);
  const cuenta = { yaEstaban: 0, copiadas: {}, rescatadas: {}, irrecuperables: [] };
  for (const b of FUENTES) {
    cuenta.copiadas[b] = 0;
    cuenta.rescatadas[b] = 0;
  }

  for (const clave of claves) {
    if (inv[DEST].has(clave)) {
      cuenta.yaEstaban++;
      continue;
    }

    // Origen vivo
    const vivoEn = FUENTES.find((b) => inv[b].vivos.has(clave));
    if (vivoEn) {
      if (!APPLY) {
        cuenta.copiadas[vivoEn]++;
        continue;
      }
      try {
        await copiarYVerificar(storage.bucket(vivoEn).file(clave), dest.file(clave));
        cuenta.copiadas[vivoEn]++;
      } catch (e) {
        cuenta.irrecuperables.push(`${clave}: copia desde ${vivoEn} falló — ${e.message.slice(0, 70)}`);
      }
      continue;
    }

    // Origen soft-deleted: hay que restaurarlo primero
    const borradoEn = FUENTES.find((b) => inv[b].borrados.has(clave));
    if (borradoEn) {
      if (!APPLY) {
        cuenta.rescatadas[borradoEn]++;
        continue;
      }
      try {
        const generation = inv[borradoEn].borrados.get(clave);
        const origen = storage.bucket(borradoEn).file(clave);
        await origen.restore({ generation });
        await copiarYVerificar(origen, dest.file(clave));
        cuenta.rescatadas[borradoEn]++;
      } catch (e) {
        cuenta.irrecuperables.push(`${clave}: rescate desde ${borradoEn} falló — ${e.message.slice(0, 70)}`);
      }
      continue;
    }

    cuenta.irrecuperables.push(`${clave}: no está vivo ni soft-deleted en ningún bucket`);
  }

  return cuenta;
}

/** Copia server-side y no la da por buena hasta confirmar que el destino existe y pesa igual. */
async function copiarYVerificar(origen, destino) {
  await origen.copy(destino);
  const [[a], [b]] = await Promise.all([origen.getMetadata(), destino.getMetadata()]);
  if (String(a.size) !== String(b.size)) {
    throw new Error(`tamaño distinto tras copiar (${a.size} -> ${b.size})`);
  }
}

// ─── main ───────────────────────────────────────────────────────────────────────────────────────

async function main() {
  log(APPLY ? '⚠  MODO REAL: se copian objetos (ninguna base de datos se modifica)' : 'ℹ  SIMULACRO: no se escribe nada');
  log(`   destino: ${DEST}   ·   fuentes: ${FUENTES.join(', ')}`);
  log(`   carpetas: ${PREFIJOS.join(' ')}`);

  const claves = await recolectarClaves();
  if (claves.size === 0) {
    log('\nNo hay nada que copiar.');
    return;
  }

  const storage = getStorage();
  const inv = await construirInventarios(storage);
  const c = await asegurar(storage, claves, inv);

  log('\n─── RESULTADO ───');
  log(`  ya estaban en ${DEST}: ${c.yaEstaban}`);
  for (const b of FUENTES) {
    if (c.copiadas[b]) log(`  ${APPLY ? 'copiadas' : 'se copiarían'} desde ${b}: ${c.copiadas[b]}`);
    if (c.rescatadas[b]) log(`  ${APPLY ? 'RESCATADAS' : 'SE RESCATARÍAN'} de soft-delete en ${b}: ${c.rescatadas[b]}`);
  }
  log(`  irrecuperables: ${c.irrecuperables.length}`);
  for (const l of c.irrecuperables.slice(0, 20)) log(`      ${l}`);
  if (c.irrecuperables.length > 20) log(`      … y ${c.irrecuperables.length - 20} más`);

  const cubiertas = claves.size - c.irrecuperables.length;
  log(`\n  cobertura: ${cubiertas}/${claves.size} (${((cubiertas / claves.size) * 100).toFixed(1)}%)`);

  if (!APPLY) log('\nNada de esto se ejecutó. Repite con --apply cuando el simulacro se vea bien.');
  else log('\nListo. Ninguna base de datos se ha modificado: el sitio sigue sirviendo desde las URLs de siempre.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Fallo:', e);
    process.exit(1);
  });
