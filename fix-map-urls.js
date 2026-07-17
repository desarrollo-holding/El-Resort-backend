/**
 * Verificar videos de todas las propiedades.
 */
const mongoose = require("mongoose");

const MONGO_URI =
  "mongodb://root:pFb87RRAPxTlQPpP@ac-t8ttbek-shard-00-00.6vr5r2q.mongodb.net:27017,ac-t8ttbek-shard-00-01.6vr5r2q.mongodb.net:27017,ac-t8ttbek-shard-00-02.6vr5r2q.mongodb.net:27017/extras_resort?ssl=true&replicaSet=atlas-m7egv7-shard-0&authSource=admin&appName=Extras-clone";

async function main() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const specsCol = db.collection("roomtypelocalspecs");

  const allSpecs = await specsCol.find({}).sort({ roomTypeID: 1 }).toArray();

  console.log("═══════════════════════════════════════════");
  console.log("  VIDEOS DE PROPIEDADES");
  console.log("═══════════════════════════════════════════\n");

  for (const spec of allSpecs) {
    const videos = spec.video_url || [];
    const poster = spec.portada_video || "(sin poster)";
    const hasVideos = Array.isArray(videos) && videos.length > 0 && videos.some(v => v && v.trim());

    console.log(`   Room Type: ${spec.roomTypeID}`);
    console.log(`   Videos: ${hasVideos ? videos.filter(v => v && v.trim()).join(", ") : "(ninguno)"}`);
    console.log(`   Poster: ${poster}`);
    console.log();
  }

  await mongoose.disconnect();
}

main().catch(console.error);
