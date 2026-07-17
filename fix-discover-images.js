/**
 * Script para reemplazar imágenes de memes en roomDetailsDiscoverSection
 * con imágenes reales del resort desde Google Cloud Storage.
 */

const mongoose = require("mongoose");

const MONGO_URI =
  "mongodb://root:pFb87RRAPxTlQPpP@ac-t8ttbek-shard-00-00.6vr5r2q.mongodb.net:27017,ac-t8ttbek-shard-00-01.6vr5r2q.mongodb.net:27017,ac-t8ttbek-shard-00-02.6vr5r2q.mongodb.net:27017/extras_resort?ssl=true&replicaSet=atlas-m7egv7-shard-0&authSource=admin&appName=Extras-clone";

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Conectado a MongoDB\n");

  const db = mongoose.connection.db;
  const mediaCol = db.collection("landingmedias");
  const sectionsCol = db.collection("landingpagesections");

  const discoverSection = await sectionsCol.findOne({ name: "roomDetailsDiscoverSection" });
  if (!discoverSection) {
    console.log("❌ No se encontró roomDetailsDiscoverSection");
    await mongoose.disconnect();
    return;
  }

  const media = await mediaCol.findOne({ sectionId: discoverSection._id });
  if (!media) {
    console.log("❌ No se encontró registro de media para roomDetailsDiscoverSection");
    await mongoose.disconnect();
    return;
  }

  console.log("📋 Media actual:");
  console.log(JSON.stringify(media.json, null, 2));

  // Imágenes reales del resort (de otras secciones que ya funcionan en producción)
  const updatedJson = {
    cards: {
      location: {
        cover: {
          src: "https://storage.googleapis.com/marketing_gallery/fotosresort/archivo-7c67c259-1269-4538-90ed-e884edf13b2b.webp",
          kind: "image",
          status: "existing",
        },
      },
      testimonial: {
        cover: {
          src: "https://storage.googleapis.com/marketing_gallery/fotosresort/archivo-8850f25b-5cce-4217-a928-279f46dff27f.jpg",
          kind: "image",
          status: "existing",
        },
      },
    },
  };

  console.log("\n🔄 Reemplazando imágenes...");
  console.log("   location: i.pinimg.com (meme) → GCS (mapa real)");
  console.log("   testimonial: i.pinimg.com (meme) → GCS (foto real)");

  await mediaCol.updateOne(
    { _id: media._id },
    { $set: { json: updatedJson } }
  );

  console.log("\n✅ Imágenes actualizadas en MongoDB");

  // Verificar
  const updated = await mediaCol.findOne({ _id: media._id });
  console.log("\n📋 Media después de actualizar:");
  console.log(JSON.stringify(updated.json, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
