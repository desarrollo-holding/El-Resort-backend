const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.DATABASE_URL;
const SUPABASE_PATTERN = /supabase\.co/;

async function checkSupabaseUrls() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Conectado a MongoDB. Buscando URLs de Supabase residuales...\n');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();

  let totalSupabaseFound = 0;

  for (const col of collections) {
    const collectionName = col.name;
    if (collectionName.startsWith('system')) continue;

    const regexQuery = {
      $or: [
        { portada: SUPABASE_PATTERN },
        { portadaMenu: SUPABASE_PATTERN },
        { imagenes: SUPABASE_PATTERN },
        { extraGalleryImages: SUPABASE_PATTERN },
        { 'bedrooms.photos': SUPABASE_PATTERN },
        { comprobantePagoUrl: SUPABASE_PATTERN },
        { mapUrl: SUPABASE_PATTERN },
        { 'json.decoratives.topFlower.src': SUPABASE_PATTERN },
        { 'json.decoratives.bottomLeaf.src': SUPABASE_PATTERN },
        { 'json.decoratives.recommendationIcon.src': SUPABASE_PATTERN }
      ]
    };

    // Usamos $elemMatch para buscar dentro de arrays de forma segura en MongoDB
    const count = await db.collection(collectionName).countDocuments(regexQuery);
    
    if (count > 0) {
      console.log(`🔴 Colección "${collectionName}": ${count} documentos aún apuntan a Supabase.`);
      totalSupabaseFound += count;
    }
  }

  console.log('\n' + (totalSupabaseFound === 0 
    ? '🎉 ¡Felicidades! Todas las URLs de la base de datos ya apuntan a Google Cloud Storage.' 
    : `⚠️ Aún hay ${totalSupabaseFound} campos apuntando a Supabase. Deberás revisarlos manualmente o ejecutar el script de actualización.`));

  await mongoose.disconnect();
}

checkSupabaseUrls().catch(err => {
  console.error('❌ Error:', err);
});