/**
 * Limpia etiquetas <strong> y <b> de los campos "description" en
 * la colección textoslandingpages de MongoDB.
 *
 * Ejecutar desde El-Resort-backend: node fix-strip-strong-body.js
 */

const mongoose = require("mongoose");

require("dotenv").config();

const MONGO_URI = process.env.DATABASE_URL;
if (!MONGO_URI) {
  console.error("DATABASE_URL no está definido (revisa tu .env)");
  process.exit(1);
}

function stripStrongTags(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/<\/?strong>/gi, "")
    .replace(/<\/?b>/gi, "");
}

function stripStrongFromValue(value) {
  if (typeof value === "string") {
    return stripStrongTags(value);
  }
  if (Array.isArray(value)) {
    return value.map(stripStrongFromValue);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = stripStrongFromValue(v);
    }
    return result;
  }
  return value;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Conectado a MongoDB\n");

  const db = mongoose.connection.db;
  const textosCol = db.collection("textoslandingpages");

  const docs = await textosCol.find({}).toArray();
  let updatedCount = 0;

  for (const doc of docs) {
    const json = doc.json;
    if (!json || typeof json !== "object") continue;

    const newJson = stripStrongFromValue(json);
    const oldStr = JSON.stringify(json);
    const newStr = JSON.stringify(newJson);

    if (oldStr !== newStr) {
      await textosCol.updateOne(
        { _id: doc._id },
        { $set: { json: newJson } }
      );
      updatedCount++;
      console.log(`  Limpiado: ${doc._id} (idioma: ${doc.idioma})`);
    }
  }

  console.log(`\nListo. ${updatedCount} documentos actualizados de ${docs.length} totales.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
