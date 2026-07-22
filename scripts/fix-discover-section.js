/**
 * Script para investigar y corregir la sección "Descubre el Resort"
 * en MongoDB.
 *
 * Ejecutar desde El-Resort-backend: node fix-discover-section.js
 * (usa mongoose que ya está instalado en el backend)
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
  console.log("✅ Conectado a MongoDB\n");

  const db = mongoose.connection.db;
  const textosCol = db.collection("textoslandingpages");
  const sectionsCol = db.collection("landingpagesections");
  const mediaCol = db.collection("landingmedias");

  // ─── 1. Listar secciones ───
  console.log("═══════════════════════════════════════════");
  console.log("  1. SECCIONES DE LA LANDING");
  console.log("═══════════════════════════════════════════\n");

  const sections = await sectionsCol.find({}).toArray();
  for (const s of sections) {
    console.log(`   ${s.name} (${s._id})`);
  }

  // ─── 2. Buscar textos con "asd" o placeholder ───
  console.log("\n═══════════════════════════════════════════");
  console.log("  2. TEXTOS CON 'asd' O PLACEHOLDERS");
  console.log("═══════════════════════════════════════════\n");

  const allTextsEs = await textosCol.find({ idioma: "es" }).toArray();

  for (const text of allTextsEs) {
    const jsonStr = JSON.stringify(text.json);
    const hasAsd = jsonStr.toLowerCase().includes("asd");
    const hasBackup = jsonStr.includes("ESTO ES BACKUP");
    const hasDescubre = jsonStr.includes("DESCUBRE");

    if (hasAsd || hasBackup || hasDescubre) {
      const sectionObj = sections.find((s) => s._id.toString() === text.section.toString());
      console.log(`   📄 Sección: ${sectionObj?.name || text.section}`);
      console.log(`   ID: ${text._id}`);
      console.log(`   title: "${text.json?.title}"`);
      console.log(`   json completo: ${JSON.stringify(text.json, null, 2).substring(0, 500)}`);
      console.log();
    }
  }

  // ─── 3. Corregir títulos ───
  console.log("═══════════════════════════════════════════");
  console.log("  3. CORRIGIENDO TÍTULOS");
  console.log("═══════════════════════════════════════════\n");

  for (const text of allTextsEs) {
    if (text.json?.title && typeof text.json.title === "string") {
      let corrected = text.json.title;
      let changed = false;

      // Quitar "asd"
      if (corrected.toLowerCase().includes("asd")) {
        corrected = corrected.replace(/\s*asd\s*/gi, "").trim();
        changed = true;
      }

      // Corregir "ESTO ES BACKUP"
      if (corrected === "ESTO ES BACKUP") {
        corrected = "DESCUBRE EL RESORT";
        changed = true;
      }

      // Corregir "DESCUBRE EL RESORT DESDE LA BASE"
      if (corrected === "DESCUBRE EL RESORT DESDE LA BASE") {
        corrected = "DESCUBRE EL RESORT";
        changed = true;
      }

      if (changed) {
        const sectionObj = sections.find((s) => s._id.toString() === text.section.toString());
        console.log(`   ✏️  Sección: ${sectionObj?.name || text.section}`);
        console.log(`      "${text.json.title}" → "${corrected}"`);

        await textosCol.updateOne(
          { _id: text._id },
          { $set: { "json.title": corrected } }
        );
        console.log(`      ✅ Actualizado en MongoDB\n`);
      }
    }
  }

  // ─── 4. Listar imágenes de LandingMedia ───
  console.log("═══════════════════════════════════════════");
  console.log("  4. IMÁGENES EN LandingMedia");
  console.log("═══════════════════════════════════════════\n");

  const allMedia = await mediaCol.find({}).toArray();

  for (const media of allMedia) {
    const sectionObj = sections.find((s) => s._id.toString() === media.sectionId?.toString());
    const sectionName = sectionObj?.name || media.sectionId || "GLOBAL";
    const jsonStr = JSON.stringify(media.json);
    const urls = jsonStr.match(/https?:\/\/[^\s"]+/g);

    if (urls && urls.length > 0) {
      console.log(`   🖼️  ${sectionName} / ${media.nombre}`);
      for (const url of urls) {
        const isMeme = /meme|cat|gato|funny|imgur|redd\.it|twitter|cdn\.discord|watashi/i.test(url);
        const isPlaceholder = /placeholder|via\.placeholder|lorem/i.test(url);
        const flag = isMeme ? " ⚠️  MEME" : isPlaceholder ? " ⚠️  PLACEHOLDER" : "";
        console.log(`      → ${url}${flag}`);
      }
      console.log();
    }
  }

  // ─── 5. Buscar específicamente en roomDetailsDiscoverSection ───
  console.log("═══════════════════════════════════════════");
  console.log("  5. IMÁGENES DE roomDetailsDiscoverSection");
  console.log("═══════════════════════════════════════════\n");

  const discoverSection = sections.find((s) => s.name === "roomDetailsDiscoverSection");
  if (discoverSection) {
    const discoverMedia = await mediaCol.find({ sectionId: discoverSection._id }).toArray();
    console.log(`   Sección: ${discoverSection.name} (${discoverSection._id})`);
    console.log(`   Imágenes: ${discoverMedia.length}\n`);

    for (const media of discoverMedia) {
      console.log(`   - nombre: ${media.nombre}`);
      console.log(`     _id: ${media._id}`);
      console.log(`     json: ${JSON.stringify(media.json, null, 2)}`);
      console.log();
    }
  }

  console.log("\n✅ Investigación completada.");
  console.log("   Si ves URLs de memes, necesitas reemplazarlas desde el Dashboard");
  console.log("   o ejecutar comandos directos en MongoDB Compass.\n");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
