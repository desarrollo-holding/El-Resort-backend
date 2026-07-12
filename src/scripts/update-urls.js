const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.DATABASE_URL;
const SUPABASE_BASE = 'https://lzckuzhzecmuoqmpohad.supabase.co/storage/v1/object/public/landing_photos/';
const GCS_BASE = 'https://storage.googleapis.com/marketing_gallery/fotosresort/';

async function updateDatabase() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Conectado a MongoDB. Iniciando actualización de URLs...\n');

  const db = mongoose.connection.db;

  // --- 1. Actualizar roomtypelocalspecs ---
  console.log('Procesando roomtypelocalspecs...');
  const roomResult = await db.collection('roomtypelocalspecs').updateMany(
    {
      $or: [
        { portada: { $regex: SUPABASE_BASE } },
        { portadaMenu: { $regex: SUPABASE_BASE } },
        { extraGalleryImages: { $regex: SUPABASE_BASE } },
        { 'bedrooms.photos': { $regex: SUPABASE_BASE } },
      ],
    },
    [
      {
        $set: {
          portada: { $replaceOne: { input: '$portada', find: SUPABASE_BASE, replacement: GCS_BASE } },
          portadaMenu: { $replaceOne: { input: '$portadaMenu', find: SUPABASE_BASE, replacement: GCS_BASE } },
          extraGalleryImages: {
            $map: {
              input: '$extraGalleryImages',
              as: 'img',
              in: { $replaceOne: { input: '$$img', find: SUPABASE_BASE, replacement: GCS_BASE } },
            },
          },
          bedrooms: {
            $map: {
              input: '$bedrooms',
              as: 'bed',
              in: {
                $mergeObjects: [
                  '$$bed',
                  {
                    photos: {
                      $map: {
                        input: '$$bed.photos',
                        as: 'photo',
                        in: { $replaceOne: { input: '$$photo', find: SUPABASE_BASE, replacement: GCS_BASE } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ]
  );
  console.log(`✅ roomtypelocalspecs: ${roomResult.modifiedCount} documentos modificados.`);

  // --- 2. Actualizar pagomensualcomercials ---
  console.log('\nProcesando pagomensualcomercials...');
  const pagoResult = await db.collection('pagomensualcomercials').updateMany(
    { comprobantePagoUrl: { $regex: SUPABASE_BASE } },
    [{ $set: { comprobantePagoUrl: { $replaceOne: { input: '$comprobantePagoUrl', find: SUPABASE_BASE, replacement: GCS_BASE } } } }]
  );
  console.log(`✅ pagomensualcomercials: ${pagoResult.modifiedCount} documentos.`);

  // --- 3. Actualizar condominios ---
  console.log('\nProcesando condominios...');
  const condResult = await db.collection('condominios').updateMany(
    { mapUrl: { $regex: SUPABASE_BASE } },
    [{ $set: { mapUrl: { $replaceOne: { input: '$mapUrl', find: SUPABASE_BASE, replacement: GCS_BASE } } } }]
  );
  console.log(`✅ condominios: ${condResult.modifiedCount} documentos.`);

  // --- 4. Actualizar landingmedias ---
  // Aquí las rutas están dentro del objeto 'json', por lo que actualizamos cada campo por separado
  console.log('\nProcesando landingmedias...');
  // topFlower
  const flowerResult = await db.collection('landingmedias').updateMany(
    { 'json.decoratives.topFlower.src': { $regex: SUPABASE_BASE } },
    [{ $set: { 'json.decoratives.topFlower.src': { $replaceOne: { input: '$json.decoratives.topFlower.src', find: SUPABASE_BASE, replacement: GCS_BASE } } } }]
  );
  console.log(`✅ landingmedias (topFlower): ${flowerResult.modifiedCount} documentos.`);

  // bottomLeaf
  const leafResult = await db.collection('landingmedias').updateMany(
    { 'json.decoratives.bottomLeaf.src': { $regex: SUPABASE_BASE } },
    [{ $set: { 'json.decoratives.bottomLeaf.src': { $replaceOne: { input: '$json.decoratives.bottomLeaf.src', find: SUPABASE_BASE, replacement: GCS_BASE } } } }]
  );
  console.log(`✅ landingmedias (bottomLeaf): ${leafResult.modifiedCount} documentos.`);

  // recommendationIcon
  const recResult = await db.collection('landingmedias').updateMany(
    { 'json.decoratives.recommendationIcon.src': { $regex: SUPABASE_BASE } },
    [{ $set: { 'json.decoratives.recommendationIcon.src': { $replaceOne: { input: '$json.decoratives.recommendationIcon.src', find: SUPABASE_BASE, replacement: GCS_BASE } } } }]
  );
  console.log(`✅ landingmedias (recommendationIcon): ${recResult.modifiedCount} documentos.`);

  // --- 5. Actualizar areas (ya confirmado) ---
  console.log('\nProcesando areas...');
  const areasResult = await db.collection('areas').updateMany(
    { imagenes: { $regex: SUPABASE_BASE } },
    [
      {
        $set: {
          imagenes: {
            $map: {
              input: '$imagenes',
              as: 'img',
              in: { $replaceOne: { input: '$$img', find: SUPABASE_BASE, replacement: GCS_BASE } },
            },
          },
        },
      },
    ]
  );
  console.log(`✅ areas: ${areasResult.modifiedCount} documentos.`);

  // --- 6. Actualizar extras (lo más probable) ---
  console.log('\nProcesando extras...');
  const extrasResult = await db.collection('extras').updateMany(
    { imagenes: { $regex: SUPABASE_BASE } },
    [
      {
        $set: {
          imagenes: {
            $map: {
              input: '$imagenes',
              as: 'img',
              in: { $replaceOne: { input: '$$img', find: SUPABASE_BASE, replacement: GCS_BASE } },
            },
          },
        },
      },
    ]
  );
  console.log(`✅ extras: ${extrasResult.modifiedCount} documentos.`);

  console.log('\n🎉 ¡Actualización completada!');
  await mongoose.disconnect();
}

updateDatabase().catch((err) => {
  console.error('❌ Error durante la actualización:', err);
  process.exit(1);
});