/**
 * Migración de imágenes Supabase → Google Cloud Storage
 *
 * Uso:  npx ts-node migrate-supabase-to-gcs.ts
 *       o   npx tsx migrate-supabase-to-gcs.ts
 *
 * Revisa TODOS los campos `src` anidados dentro de doc.json
 * en la colección landingmedias. Si contienen una URL de supabase.co,
 * descarga la imagen, la sube a GCS y actualiza MongoDB.
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import axios from "axios";
import { Storage } from "@google-cloud/storage";

dotenv.config();

// ── Configuración ──────────────────────────────────────────────
const BUCKET_NAME = process.env.GCS_BUCKET_RESORT ?? "marketing_gallery";
const GCS_FOLDER = "fotosresort";
const GCS_BASE_URL = `https://storage.googleapis.com/${BUCKET_NAME}/${GCS_FOLDER}`;

const gcsCredentials = JSON.parse(process.env.GOOGLE_CLOUD_STORAGE_CREDENTIALS!);
const storage = new Storage({ credentials: gcsCredentials, projectId: gcsCredentials.project_id });
const bucket = storage.bucket(BUCKET_NAME);

// ── Contadores ─────────────────────────────────────────────────
let alreadyInGCS = 0;
let downloadedAndUploaded = 0;
let errors = 0;

// ── Utilidades ─────────────────────────────────────────────────

/** Busca recursivamente todas las propiedades llamadas `src` en un objeto. */
function findAllSrcPaths(obj: any, prefix = ""): { path: string; value: string }[] {
  const results: { path: string; value: string }[] = [];

  if (obj === null || obj === undefined || typeof obj !== "object") return results;

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      results.push(...findAllSrcPaths(item, `${prefix}[${idx}]`));
    });
    return results;
  }

  for (const key of Object.keys(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;

    if (key === "src" && typeof obj[key] === "string") {
      results.push({ path: currentPath, value: obj[key] });
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      results.push(...findAllSrcPaths(obj[key], currentPath));
    }
  }

  return results;
}

/** Setea un valor anidado en un objeto usando un path como "subsections.logo.src". */
function setNestedValue(obj: any, path: string, newValue: string): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    // Manejar arrays: "items[0]" → key="items", index=0
    const arrayMatch = parts[i].match(/^([^\[]+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]][parseInt(arrayMatch[2])];
    } else {
      current = current[parts[i]];
    }
  }

  const lastPart = parts[parts.length - 1];
  const arrayMatch = lastPart.match(/^([^\[]+)\[(\d+)\]$/);
  if (arrayMatch) {
    current[arrayMatch[1]][parseInt(arrayMatch[2])] = newValue;
  } else {
    current[lastPart] = newValue;
  }
}

/** Extrae el nombre del archivo de una URL (la parte después del último /). */
function extractFilename(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1].split("?")[0]; // quitar query params si existen
}

/** Verifica si un archivo existe en GCS. */
async function fileExistsInGCS(filename: string): Promise<boolean> {
  const [exists] = await bucket.file(`${GCS_FOLDER}/${filename}`).exists();
  return exists;
}

/** Descarga una imagen desde Supabase y la sube a GCS. */
async function downloadAndUpload(supabaseUrl: string, filename: string): Promise<void> {
  const response = await axios.get(supabaseUrl, { responseType: "arraybuffer", timeout: 30000 });

  const contentType = (response.headers["content-type"] as string) || "application/octet-stream";
  const file = bucket.file(`${GCS_FOLDER}/${filename}`);

  await new Promise<void>((resolve, reject) => {
    const stream = file.createWriteStream({ contentType, metadata: { cacheControl: "public, max-age=31536000" } });
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.end(Buffer.from(response.data));
  });
}

// ── Migración principal ────────────────────────────────────────

async function migrate() {
  console.log("🔗 Conectando a MongoDB...");
  await mongoose.connect(process.env.DATABASE_URL!);
  console.log("✅ Conectado.\n");

  // Obtener la colección directamente (evita necesitar un modelo registrado)
  const collection = mongoose.connection.db!.collection("landingmedias");

  const totalDocs = await collection.countDocuments();
  console.log(`📄 Documentos en landingmedias: ${totalDocs}\n`);

  const docs = await collection.find({}).toArray();
  let docsModified = 0;

  for (const doc of docs) {
    const srcPaths = findAllSrcPaths(doc.json);

    // Filtrar solo URLs de Supabase
    const supabaseSrcs = srcPaths.filter((s) => s.value.includes("supabase.co"));

    if (supabaseSrcs.length === 0) continue;

    let docChanged = false;

    for (const { path, value } of supabaseSrcs) {
      const filename = extractFilename(value);

      try {
        const exists = await fileExistsInGCS(filename);

        if (exists) {
          console.log(`  ✔ Ya en GCS: ${filename}`);
          alreadyInGCS++;
        } else {
          console.log(`  ⬇ Descargando y subiendo: ${filename} ...`);
          await downloadAndUpload(value, filename);
          downloadedAndUploaded++;
          console.log(`  ✅ Subido: ${filename}`);
        }

        // Reemplazar la URL en el objeto json
        const newUrl = `${GCS_BASE_URL}/${filename}`;
        setNestedValue(doc.json, path, newUrl);
        docChanged = true;
      } catch (err: any) {
        console.error(`  ❌ Error con ${filename}: ${err.message}`);
        errors++;
      }
    }

    // Guardar solo si algo cambió
    if (docChanged) {
      await collection.updateOne({ _id: doc._id }, { $set: { json: doc.json } });
      docsModified++;
    }
  }

  // ── Reporte final ──────────────────────────────────────────
  console.log("\n═══════════════════════════════════════");
  console.log("  REPORTE DE MIGRACIÓN");
  console.log("═══════════════════════════════════════");
  console.log(`  Documentos procesados:        ${totalDocs}`);
  console.log(`  Documentos modificados:       ${docsModified}`);
  console.log(`  URLs ya en GCS (sin cambio):  ${alreadyInGCS}`);
  console.log(`  Imágenes descargadas+subidas: ${downloadedAndUploaded}`);
  console.log(`  Errores:                      ${errors}`);
  console.log("═══════════════════════════════════════\n");

  await mongoose.disconnect();
  console.log("🔌 Desconectado de MongoDB.");
}

migrate().catch((err) => {
  console.error("💥 Error fatal:", err);
  process.exit(1);
});
