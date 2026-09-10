import mongoose from "mongoose";
import { COLLECTION_RULES, modeFor, normalizePathPattern } from "./collections";
import { collectMediaRefs, type MediaClassification, type MediaRef, type MediaRefMode } from "./mediaRefs";

/**
 * Inventario de medios: SOLO LECTURA. Recorre las colecciones, clasifica cada referencia y agrupa
 * por colección y por patrón de ruta.
 *
 * Existe separado de la corrida por la razón de §6.4 de la guía: poder responder "¿qué haría y
 * cuánto ahorraría?" antes de tocar producción. Y también porque el agrupado por patrón de ruta es
 * lo que permite revisar, campo por campo, que el modo de escritura (`asset` / `url-only`) es el
 * correcto para el esquema — un `$set` de un objeto sobre un campo `String` es el tipo de error que
 * no da excepción y se descubre mirando la web.
 *
 * No pide nada por red: se calcula solo con los documentos, para que el reporte salga al instante
 * aunque el bucket esté lento. El peso en bytes es un paso aparte y opcional (`--sizes`).
 */

export type InventoryEntry = {
  collection: string;
  /** Ruta con los índices de array normalizados (`imagenes.#.url`). */
  pathPattern: string;
  mode: MediaRefMode;
  counts: Record<MediaClassification, number>;
  /** Un ejemplo real, para poder mirarlo a mano. */
  sampleUrl?: string;
};

export type PendingItem = {
  collection: string;
  docId: string;
  path: string;
  pathPattern: string;
  mode: MediaRefMode;
  shape: MediaRef["shape"];
  url: string;
};

export type Inventory = {
  entries: InventoryEntry[];
  pending: PendingItem[];
  totals: Record<MediaClassification, number>;
  missingCollections: string[];
};

const emptyCounts = (): Record<MediaClassification, number> => ({
  migrada: 0,
  pendiente: 0,
  revertida: 0,
  video: 0,
  externa: 0,
  "sin-marca": 0,
});

export async function buildInventory(bucket: string): Promise<Inventory> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Sin conexión a MongoDB");

  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const byKey = new Map<string, InventoryEntry>();
  const pending: PendingItem[] = [];
  const totals = emptyCounts();
  const missingCollections: string[] = [];

  for (const rule of COLLECTION_RULES) {
    if (!existing.has(rule.collection)) {
      missingCollections.push(rule.collection);
      continue;
    }

    // La lista de trabajo se materializa ANTES de tocar nada, no con un cursor abierto durante
    // toda la corrida: son pocos documentos y así no se mantiene un cursor vivo varios minutos
    // contra el clúster.
    const docs = await db.collection(rule.collection).find({}).toArray();

    for (const doc of docs) {
      for (const ref of collectMediaRefs(doc as Record<string, unknown>, bucket)) {
        const pathPattern = normalizePathPattern(ref.path);
        const mode = modeFor(rule, ref);
        const key = `${rule.collection}|${pathPattern}|${mode}`;

        let entry = byKey.get(key);
        if (!entry) {
          entry = { collection: rule.collection, pathPattern, mode, counts: emptyCounts() };
          byKey.set(key, entry);
        }
        entry.counts[ref.classification] += 1;
        totals[ref.classification] += 1;
        if (!entry.sampleUrl) entry.sampleUrl = ref.url;

        if (ref.classification === "pendiente") {
          pending.push({
            collection: rule.collection,
            docId: String((doc as { _id: unknown })._id),
            path: ref.path,
            pathPattern,
            mode,
            shape: ref.shape,
            url: ref.url,
          });
        }
      }
    }
  }

  const entries = [...byKey.values()].sort(
    (a, b) =>
      b.counts.pendiente - a.counts.pendiente ||
      a.collection.localeCompare(b.collection) ||
      a.pathPattern.localeCompare(b.pathPattern)
  );

  return { entries, pending, totals, missingCollections };
}

/** Peso actual de las URLs pendientes, con un `HEAD` por URL distinta. */
export async function measurePendingBytes(pending: PendingItem[], concurrency = 10) {
  const urls = [...new Set(pending.map((item) => item.url))];
  let bytes = 0;
  let measured = 0;
  let failed = 0;
  const perUrl = new Map<string, number>();

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const sizes = await Promise.all(
      batch.map(async (url) => {
        try {
          const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
          if (!response.ok) return null;
          return Number(response.headers.get("content-length") || 0);
        } catch {
          return null;
        }
      })
    );
    batch.forEach((url, index) => {
      const size = sizes[index];
      if (size === null) failed += 1;
      else {
        measured += 1;
        bytes += size;
        perUrl.set(url, size);
      }
    });
  }

  return { distinctUrls: urls.length, measured, failed, bytes, perUrl };
}
