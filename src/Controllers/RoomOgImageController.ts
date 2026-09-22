// `GET /api/rooms/:roomTypeID/og.jpg` — la imagen que ven WhatsApp/Facebook/LinkedIn al compartir
// la ficha de una propiedad. El porqué de generarla (y no servir una foto tal cual) está en
// services/roomOgImage.service.ts.
//
// Lee SOLO de Mongo (`roomtypelocalspecs`): la foto y su encuadre son datos del panel, no de
// Cloudbeds. Así este endpoint sigue respondiendo aunque la integración de tarifas esté caída, que
// importa porque lo consume un bot que no vuelve a intentar.
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import RoomTypeLocalSpecs from "../models/RoomTypeLocalSpecs";
import { sendErrorResponse } from "../utils/errors";
import { parseCropCoordinates, renderOgImage, type CropRect } from "../services/roomOgImage.service";
import { normalizeImageAsset } from "../models/shared/imageAsset";

/**
 * Caché en memoria. Son dieciséis propiedades y ~150 KB por imagen, así que el tope holgado de 32
 * entradas cubre el catálogo entero por menos de 5 MB, y evita re-decodificar en cada visita de un
 * bot. La clave lleva la huella de (foto, encuadre): si el admin cambia cualquiera de las dos, la
 * entrada vieja deja de usarse sola, sin invalidación explícita.
 */
const CACHE_LIMIT = 32;
const cache = new Map<string, Buffer>();

function remember(key: string, buffer: Buffer) {
  // Map conserva el orden de inserción: la primera clave es la más vieja.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, buffer);
}

/** Identifica el contenido: cambia si cambia la foto o el encuadre, y sirve de ETag. */
function fingerprint(sourceUrl: string, rect: CropRect | null): string {
  const rectKey = rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : "full";
  return createHash("sha1").update(`${sourceUrl}|${rectKey}`).digest("hex").slice(0, 16);
}

/** La URL más grande disponible de la `portada`: se recorta del original, no de una variante. */
function resolveSourceUrl(portada: unknown): string | null {
  const asset = normalizeImageAsset(portada);
  const url = typeof asset?.url === "string" ? asset.url.trim() : "";
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export class RoomOgImageController {
  static showRoomOgImage = async (req: Request, res: Response): Promise<void> => {
    try {
      const roomTypeID = String(req.params.roomTypeID ?? "").trim();
      if (!roomTypeID) {
        res.status(400).json({ error: "roomTypeID inválido" });
        return;
      }
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no disponible" });
        return;
      }

      const doc = await RoomTypeLocalSpecs.findOne({ roomTypeID })
        .select({ roomTypeID: 1, portada: 1, posicion_fotos_portadas: 1 })
        .lean();

      const sourceUrl = doc ? resolveSourceUrl(doc.portada) : null;
      if (!sourceUrl) {
        // Sin foto cargada no hay nada que generar. 404 y no una imagen de relleno: el que llama
        // (el frontend, al armar el og:image) tiene su propia cascada de respaldo y sabe elegir
        // mejor que este endpoint.
        res.status(404).json({ error: "La propiedad no tiene portada cargada" });
        return;
      }

      const framing = (doc?.posicion_fotos_portadas as Record<string, unknown> | null | undefined)?.portada;
      const rect = parseCropCoordinates((framing as Record<string, unknown> | undefined)?.mobile_coordinates);

      const etag = `"${fingerprint(sourceUrl, rect)}"`;
      // Un scraper que ya tiene la imagen revalida con If-None-Match: 304 y no se decodifica nada.
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      let image = cache.get(etag);
      if (!image) {
        const response = await fetch(sourceUrl);
        if (!response.ok) {
          throw new Error(`GET ${sourceUrl} -> ${response.status}`);
        }
        image = await renderOgImage(Buffer.from(await response.arrayBuffer()), rect);
        remember(etag, image);
      }

      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": image.length,
        ETag: etag,
        // Un día en el cliente y una semana en el borde. La URL que publica el frontend lleva
        // además un `?v=` derivado de la foto y el encuadre, así que al cambiarlos el bot ve una
        // URL nueva y no tiene que esperar a que expire nada.
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      });
      res.end(image);
    } catch (error) {
      sendErrorResponse(res, error, "Error al generar la imagen Open Graph");
    }
  };
}
