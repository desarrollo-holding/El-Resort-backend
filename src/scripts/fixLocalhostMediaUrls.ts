/**
 * Repara medios del landing guardados con una URL de desarrollo (`http://localhost:*`).
 *
 *   npx ts-node src/scripts/fixLocalhostMediaUrls.ts            (simulación: no escribe)
 *   npx ts-node src/scripts/fixLocalhostMediaUrls.ts --apply    (escribe)
 *
 * Pasa cuando el respaldo local (`landing-images.json`) trae una ruta del proyecto, el navegador la
 * resuelve contra el dev server y el dashboard la persiste tal cual: en producción esa URL no
 * existe. Cada `src` con localhost se reemplaza por la URL pública equivalente del mapa de abajo.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import LandingMedia from "../models/LandingMedia";

dotenv.config();

const APPLY = process.argv.includes("--apply");

/** Último segmento del archivo local → URL pública ya subida al bucket. */
const REPLACEMENTS: Record<string, string> = {
  "hojaboton.webp":
    "https://storage.googleapis.com/greendreams_bucket/fotosresort/1789074826549-b89ff582-9541-4aa0-b47f-40cd120c321a/orig.webp",
  "IMG_3144.JPG.webp":
    "https://storage.googleapis.com/greendreams_bucket/fotosresort/1789074829929-50e843a4-f93a-40b9-ad20-d5472eedc7c5/orig.webp",
};

const isLocalhostUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\/localhost(:\d+)?\//i.test(value);

const replacementFor = (url: string): string | null => {
  const fileName = url.split("?")[0].split("/").pop() ?? "";
  return REPLACEMENTS[fileName] ?? null;
};

/** Recorre el JSON y reescribe cada `src` de localhost. Devuelve los cambios hechos. */
function fixNode(node: unknown, path: string[], changes: string[]): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    node.forEach((item, i) => fixNode(item, [...path, String(i)], changes));
    return;
  }

  const obj = node as Record<string, unknown>;
  if (isLocalhostUrl(obj.src)) {
    const replacement = replacementFor(obj.src);
    if (replacement) {
      changes.push(`${path.join(".")}.src\n      antes: ${obj.src}\n      ahora: ${replacement}`);
      obj.src = replacement;
    } else {
      changes.push(`${path.join(".")}.src → SIN REEMPLAZO CONOCIDO: ${obj.src}`);
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === "src") continue;
    fixNode(value, [...path, key], changes);
  }
}

async function main() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL no está definido.");

  await mongoose.connect(databaseUrl);

  const docs = await LandingMedia.find({});
  let touched = 0;

  for (const doc of docs) {
    const json = JSON.parse(JSON.stringify(doc.json ?? {}));
    const changes: string[] = [];
    fixNode(json, [], changes);
    if (changes.length === 0) continue;

    touched += 1;
    console.log(`\n[${doc.tipo}] ${doc.nombre} (_id ${doc._id})`);
    changes.forEach((c) => console.log(`  - ${c}`));

    if (APPLY) {
      doc.set("json", json);
      doc.markModified("json");
      await doc.save();
      console.log("  => guardado");
    }
  }

  if (touched === 0) {
    console.log("Nada que reparar: ningún medio apunta a localhost.");
  } else if (!APPLY) {
    console.log(`\nSimulación: ${touched} documento(s) con cambios. Corre con --apply para escribir.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
