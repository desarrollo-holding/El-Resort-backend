import type { Request, Response } from "express";
import mongoose from "mongoose";
import LandingMedia from "../models/LandingMedia";
import { GcsStorageService } from "../services/csStorage.service";
import { InvalidImageError } from "../services/imageOptimizer";
import { TranslateService } from "../services/translate.service";
import { parseIdiomaQuery } from "../utils/idioma";

import { sendErrorResponse } from "../utils/errors";
const SECTION_NAME = "reviewsSection";
const REVIEWS_JSON_KEY = "reviews";

type ReviewDoc = {
  _id: string;
  name: string;
  text: string;
  /** Traducción persistida de `text`, resuelta la primera vez que alguien pide `idioma=en`. */
  textEn?: string;
  rating: number;
  avatarUrl: string;
  order: number;
};

async function findSectionDoc() {
  return LandingMedia.findOne({ nombre: SECTION_NAME, tipo: "SECCION" });
}

function getReviewsArray(doc: any): ReviewDoc[] {
  if (!doc?.json) return [];
  if (!Array.isArray(doc.json[REVIEWS_JSON_KEY])) {
    doc.json[REVIEWS_JSON_KEY] = [];
  }
  return doc.json[REVIEWS_JSON_KEY] as ReviewDoc[];
}

export class ReviewsController {
  /**
   * GET /api/reviews — público (landing). `idioma=en`: usa `textEn` si ya está persistido; si
   * falta, lo traduce con Gemini y lo guarda ahí mismo, para no volver a pagar el costo de
   * traducción en cada visita. `name` (nombre del huésped) nunca se traduce.
   */
  static getAll = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    try {
      const doc = await findSectionDoc();
      if (!doc) {
        res.json({ success: true, data: [] });
        return;
      }

      const reviews = getReviewsArray(doc).sort((a, b) => a.order - b.order);

      const idioma = parseIdiomaQuery(req.query.idioma) ?? "es";
      if (idioma === "en") {
        const changed = await TranslateService.backfillEnglishField(reviews, "text", "textEn");
        if (changed.length > 0) {
          // Best-effort: la respuesta ya está traducida en memoria. Si el save falla (p. ej. el
          // hook `pre("validate")` del modelo rechaza un documento heredado sin `sectionId`), el
          // visitante igual ve el inglés; sin este catch, cada visita en inglés daba un 500.
          try {
            doc.markModified("json");
            await doc.save();
          } catch (error) {
            console.error("[ReviewsController.getAll] no se pudo persistir textEn:", error);
          }
        }
      }

      const data =
        idioma === "en" ? reviews.map((r) => ({ ...r, text: r.textEn || r.text })) : reviews;

      res.json({ success: true, data });
    } catch (err) {
      console.error("[ReviewsController.getAll]", err);
      sendErrorResponse(res, err, "Error al obtener las reseñas");
    }
  };

  /** POST /api/reviews — crear reseña (dashboard, multipart) */
  static create = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    try {
      const doc = await findSectionDoc();
      if (!doc) {
        res.status(404).json({ error: "Sección reviewsSection no encontrada" });
        return;
      }

      const reviews = getReviewsArray(doc);
      const { name, text, rating } = req.body;

      let avatarUrl = "";
      const files = req.files as Express.Multer.File[] | undefined;
      const avatarFile = files?.find((f) => f.fieldname === "avatar");

      if (avatarFile) {
        const uploaded = await GcsStorageService.uploadFile({
          fileBuffer: avatarFile.buffer,
          originalName: avatarFile.originalname,
          mimeType: avatarFile.mimetype,
          mediaKind: "image",
          imageProfile: "avatar",
        });
        avatarUrl = uploaded.url;
      }

      const newReview: ReviewDoc = {
        _id: new mongoose.Types.ObjectId().toHexString(),
        name: name || "",
        text: text || "",
        rating: Math.max(1, Math.min(5, Number(rating) || 5)),
        avatarUrl,
        order: reviews.length,
      };

      reviews.push(newReview);
      doc.markModified("json");
      await doc.save();

      res.status(201).json({ success: true, data: newReview });
    } catch (err) {
      console.error("[ReviewsController.create]", err);
      if (err instanceof InvalidImageError) {
        res.status(400).json({ error: err.message });
        return;
      }
      sendErrorResponse(res, err, "Error al crear la reseña");
    }
  };

  /** PUT /api/reviews/:reviewId — actualizar reseña (dashboard, multipart) */
  static update = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    try {
      const { reviewId } = req.params;
      const doc = await findSectionDoc();
      if (!doc) {
        res.status(404).json({ error: "Sección reviewsSection no encontrada" });
        return;
      }

      const reviews = getReviewsArray(doc);
      const idx = reviews.findIndex((r) => r._id === reviewId);
      if (idx === -1) {
        res.status(404).json({ error: "Reseña no encontrada" });
        return;
      }

      const { name, text, rating } = req.body;
      if (name !== undefined) reviews[idx].name = name;
      if (text !== undefined && text !== reviews[idx].text) {
        reviews[idx].text = text;
        // Se editó el español: la traducción vieja quedaría desactualizada, se borra y se
        // vuelve a generar sola en la próxima visita con idioma=en.
        delete reviews[idx].textEn;
      }
      if (rating !== undefined) reviews[idx].rating = Math.max(1, Math.min(5, Number(rating) || 5));

      const files = req.files as Express.Multer.File[] | undefined;
      const avatarFile = files?.find((f) => f.fieldname === "avatar");
      if (avatarFile) {
        const uploaded = await GcsStorageService.uploadFile({
          fileBuffer: avatarFile.buffer,
          originalName: avatarFile.originalname,
          mimeType: avatarFile.mimetype,
          mediaKind: "image",
          imageProfile: "avatar",
        });
        reviews[idx].avatarUrl = uploaded.url;
      }

      doc.markModified("json");
      await doc.save();

      res.json({ success: true, data: reviews[idx] });
    } catch (err) {
      console.error("[ReviewsController.update]", err);
      if (err instanceof InvalidImageError) {
        res.status(400).json({ error: err.message });
        return;
      }
      sendErrorResponse(res, err, "Error al actualizar la reseña");
    }
  };

  /** DELETE /api/reviews/:reviewId — eliminar reseña */
  static remove = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    try {
      const { reviewId } = req.params;
      const doc = await findSectionDoc();
      if (!doc) {
        res.status(404).json({ error: "Sección reviewsSection no encontrada" });
        return;
      }

      const reviews = getReviewsArray(doc);
      const idx = reviews.findIndex((r) => r._id === reviewId);
      if (idx === -1) {
        res.status(404).json({ error: "Reseña no encontrada" });
        return;
      }

      reviews.splice(idx, 1);
      reviews.forEach((r, i) => (r.order = i));
      doc.markModified("json");
      await doc.save();

      res.json({ success: true });
    } catch (err) {
      console.error("[ReviewsController.remove]", err);
      sendErrorResponse(res, err, "Error al eliminar la reseña");
    }
  };

  /** PATCH /api/reviews/reorder — reordenar reseñas */
  static reorder = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    try {
      const { reviewIds } = req.body as { reviewIds?: string[] };
      if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
        res.status(400).json({ error: "reviewIds debe ser un array no vacío" });
        return;
      }

      const doc = await findSectionDoc();
      if (!doc) {
        res.status(404).json({ error: "Sección reviewsSection no encontrada" });
        return;
      }

      const reviews = getReviewsArray(doc);
      const map = new Map(reviews.map((r) => [r._id, r]));

      const reordered: ReviewDoc[] = [];
      for (let i = 0; i < reviewIds.length; i++) {
        const found = map.get(reviewIds[i]);
        if (found) {
          found.order = i;
          reordered.push(found);
        }
      }

      (doc.json as Record<string, unknown>)[REVIEWS_JSON_KEY] = reordered;
      doc.markModified("json");
      await doc.save();

      res.json({ success: true, data: reordered });
    } catch (err) {
      console.error("[ReviewsController.reorder]", err);
      sendErrorResponse(res, err, "Error al guardar el orden de las reseñas");
    }
  };
}
