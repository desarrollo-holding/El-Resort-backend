/**
 * Inspeccion SOLO LECTURA de las URLs de medios guardadas en Mongo.
 *
 * No escribe nada. Sirve para saber, antes de migrar, cuantos documentos apuntan a cada sitio
 * (greendreams_bucket, marketing_gallery, el proxy /cms muerto, restos de Supabase o WordPress)
 * y EN QUE CAMPOS exactamente, recorriendo el documento entero en vez de una lista de campos
 * escrita a mano — que es como se escapan los campos nuevos.
 *
 * USO
 *   node src/scripts/inspect-media-urls.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const PATRONES = [
  ['greendreams_bucket', /storage\.googleapis\.com\/greendreams_bucket\//],
  ['marketing_gallery', /storage\.googleapis\.com\/marketing_gallery\//],
  ['elresort.pe/cms', /^https?:\/\/elresort\.pe\/cms\//],
  ['/cms relativo', /^\/cms\//],
  ['wp-content', /\/wp-content\//],
  ['supabase', /supabase\.co/],
  ['otra http', /^https?:\/\//],
];

function clasificar(valor) {
  if (typeof valor !== 'string') return null;
  const s = valor.trim();
  if (!s) return null;
  // Solo nos interesan cosas que parezcan una ruta de medio.
  if (!/^https?:\/\/|^\/\/|^\//.test(s)) return null;
  for (const [nombre, re] of PATRONES) {
    if (re.test(s)) return nombre;
  }
  return null;
}

/** Ruta con los indices de array colapsados a [] para que agrupen bien en el resumen. */
function rutaGenerica(path) {
  return path.replace(/\.\d+/g, '[]');
}

function recorrer(nodo, path, visitar) {
  if (Array.isArray(nodo)) {
    nodo.forEach((v, i) => recorrer(v, path ? `${path}.${i}` : String(i), visitar));
    return;
  }
  if (nodo && typeof nodo === 'object') {
    if (nodo._bsontype || nodo instanceof Date) return;
    for (const [k, v] of Object.entries(nodo)) {
      recorrer(v, path ? `${path}.${k}` : k, visitar);
    }
    return;
  }
  visitar(nodo, path);
}

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new Error('Falta DATABASE_URL');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  console.log(`Conectado a la base "${db.databaseName}" (solo lectura)\n`);

  const colecciones = await db.listCollections().toArray();
  const totalGlobal = {};
  const camposPorPatron = {};
  const muestras = {};

  for (const { name } of colecciones) {
    if (name.startsWith('system.')) continue;

    const coll = db.collection(name);
    const totalDocs = await coll.countDocuments();
    const porPatron = {};
    let docsConMedios = 0;

    const cursor = coll.find({});
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const enEsteDoc = new Set();

      recorrer(doc, '', (valor, path) => {
        const tipo = clasificar(valor);
        if (!tipo) return;
        porPatron[tipo] = (porPatron[tipo] || 0) + 1;
        totalGlobal[tipo] = (totalGlobal[tipo] || 0) + 1;
        enEsteDoc.add(tipo);

        const clave = `${tipo}`;
        camposPorPatron[clave] = camposPorPatron[clave] || {};
        const rg = `${name}: ${rutaGenerica(path)}`;
        camposPorPatron[clave][rg] = (camposPorPatron[clave][rg] || 0) + 1;

        if (!muestras[tipo]) muestras[tipo] = String(valor).slice(0, 120);
      });

      if (enEsteDoc.size > 0) docsConMedios++;
    }

    if (Object.keys(porPatron).length > 0) {
      console.log(`── ${name}  (${totalDocs} docs, ${docsConMedios} con medios)`);
      for (const [tipo, n] of Object.entries(porPatron).sort((a, b) => b[1] - a[1])) {
        console.log(`     ${String(n).padStart(5)}  ${tipo}`);
      }
      console.log('');
    }
  }

  console.log('═══ TOTAL POR DESTINO ═══');
  for (const [tipo, n] of Object.entries(totalGlobal).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${tipo}`);
    if (muestras[tipo]) console.log(`         ej: ${muestras[tipo]}`);
  }

  console.log('\n═══ CAMPOS AFECTADOS (los que hay que reescribir) ═══');
  for (const tipo of ['marketing_gallery', 'elresort.pe/cms', '/cms relativo']) {
    const campos = camposPorPatron[tipo];
    if (!campos) continue;
    console.log(`\n  ${tipo}:`);
    for (const [ruta, n] of Object.entries(campos).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`     ${String(n).padStart(5)}  ${ruta}`);
    }
  }

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fallo:', e.message);
    process.exit(1);
  });
