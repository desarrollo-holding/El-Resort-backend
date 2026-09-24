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
import { pickOgSource, renderOgImage, type CropRect } from "../services/roomOgImage.service";

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
        .select({ roomTypeID: 1, portada: 1, portadaMenu: 1, posicion_fotos_portadas: 1 })
        .lean();

      // `portadaMenu` con su encuadre de escritorio; `portada` solo si aún no hay `portadaMenu`.
      const source = pickOgSource(doc);
      if (!source) {
        // Sin foto cargada no hay nada que generar. 404 y no una imagen de relleno: el que llama
        // (el frontend, al armar el og:image) tiene su propia cascada de respaldo y sabe elegir
        // mejor que este endpoint.
        res.status(404).json({ error: "La propiedad no tiene portadaMenu ni portada cargada" });
        return;
      }
      const { url: sourceUrl, rect } = source;

      const etag = `"${fingerprint(sourceUrl, rect)}"`;
      // Un scraper que ya tiene la imagen revalida con If-None-Match: 304 y no se decodifica nada.
      if (req.headers["if-none-match"] === etag) {
        // También en el 304: el navegador vuelve a aplicar la política al revalidar, y sin la
        // cabecera acá una imagen ya cacheada dejaría de mostrarse en la primera revalidación.
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
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
        // `helmet()` pone `same-origin` en toda la API, y con eso el navegador BLOQUEA esta imagen
        // en cuanto la carga una página de otro origen — que es el caso normal: la publica
        // elresort.pe y la muestran previsualizadores ajenos. Los scrapers de WhatsApp y Facebook
        // la bajan del lado del servidor y no aplican la regla, así que el síntoma es una imagen
        // que responde 200 en un `curl` y aun así no aparece en pantalla.
        // Se levanta SOLO acá: es un archivo público hecho para embeberse en cualquier lado, a
        // diferencia del resto de la API, que sigue con el `same-origin` de helmet.
        "Cross-Origin-Resource-Policy": "cross-origin",
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
