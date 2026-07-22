const mongoose = require('mongoose');
require('dotenv').config();

// Usa tu DATABASE_URL directamente del .env
const MONGODB_URI = process.env.DATABASE_URL;

async function detectCollections() {
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Conectado a MongoDB. Buscando colecciones con imágenes de Supabase...\n");

  const collections = await mongoose.connection.db.listCollections().toArray();

  for (const col of collections) {
    const collectionName = col.name;
    if (collectionName.startsWith('system')) continue;

    // Tomamos una muestra de un solo documento para analizar su estructura
    const sample = await mongoose.connection.db.collection(collectionName).findOne({});
    if (!sample) continue;

    // Función recursiva para buscar 'supabase.co' en cualquier nivel del objeto
    function findSupabaseUrls(obj, path = '') {
      if (!obj || typeof obj !== 'object') return;

      for (const key of Object.keys(obj)) {
        const val = obj[key];
        const currentPath = path ? `${path}.${key}` : key;

        if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            if (typeof val[i] === 'string' && val[i].includes('supabase.co')) {
              console.log(`🔴 Encontrado en colección: "${collectionName}" -> Ruta: "${currentPath}[${i}]"`);
            } else if (typeof val[i] === 'object' && val[i] !== null) {
              findSupabaseUrls(val[i], `${currentPath}[${i}]`);
            }
          }
        } else if (typeof val === 'object' && val !== null) {
          findSupabaseUrls(val, currentPath);
        } else if (typeof val === 'string' && val.includes('supabase.co')) {
          console.log(`🔴 Encontrado en colección: "${collectionName}" -> Campo: "${currentPath}"`);
        }
      }
    }

    findSupabaseUrls(sample);
  }

  console.log("\n✅ Búsqueda de detección completada.");
  await mongoose.disconnect();
}

detectCollections().catch(err => {
  console.error("❌ Error:", err);
});