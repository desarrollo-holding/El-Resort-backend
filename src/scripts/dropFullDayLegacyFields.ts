/**
 * Quita de los documentos de full day los campos que dejaron de existir en el modelo
 * (`duracionHoras`, `fechaInicio`, `fechaFin`): el horario pasó a ser fijo 9am–6pm y el paquete ya
 * no tiene vigencia por fechas.
 *
 *   npx ts-node src/scripts/dropFullDayLegacyFields.ts            (simulación: no escribe)
 *   npx ts-node src/scripts/dropFullDayLegacyFields.ts --apply    (escribe)
 *
 * Mongoose no devuelve estos campos al leer con el esquema nuevo, pero sí siguen viajando en las
 * consultas `.lean()`, así que conviene borrarlos en vez de dejarlos como ruido.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import FullDay from "../models/FullDays";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const LEGACY_FIELDS = ["duracionHoras", "fechaInicio", "fechaFin"] as const;

async function main() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL no está definido.");

  await mongoose.connect(databaseUrl);

  const filter = { $or: LEGACY_FIELDS.map((field) => ({ [field]: { $exists: true } })) };
  const pending = await FullDay.find(filter).lean();

  if (pending.length === 0) {
    console.log("Nada que limpiar: ningún full day conserva campos obsoletos.");
    return;
  }

  for (const doc of pending) {
    const present = LEGACY_FIELDS.filter((field) => field in doc);
    console.log(`- ${String(doc.nombre)} (_id ${doc._id}): ${present.join(", ")}`);
  }

  if (!APPLY) {
    console.log(`\nSimulación: ${pending.length} documento(s). Corre con --apply para escribir.`);
    return;
  }

  const unset = Object.fromEntries(LEGACY_FIELDS.map((field) => [field, ""]));
  const result = await FullDay.collection.updateMany(filter, { $unset: unset });
  console.log(`\nLimpiados ${result.modifiedCount} documento(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
