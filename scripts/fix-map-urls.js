/**
 * Verificar videos de todas las propiedades.
 */
const mongoose = require("mongoose");

require("dotenv").config();

const MONGO_URI = process.env.DATABASE_URL;
if (!MONGO_URI) {
  console.error("DATABASE_URL no está definido (revisa tu .env)");
  process.exit(1);
}

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
