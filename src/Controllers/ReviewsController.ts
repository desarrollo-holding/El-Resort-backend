import type { Request, Response } from "express";
import mongoose from "mongoose";
import LandingMedia from "../models/LandingMedia";
import { GcsStorageService } from "../services/csStorage.service";

const SECTION_NAME = "reviewsSection";
const REVIEWS_JSON_KEY = "reviews";

type ReviewDoc = {
  _id: string;
  name: string;
  text: string;
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
  /** GET /api/reviews — público (landing) */
  static getAll = async (_req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "Base de datos no conectada" });
      return;
    }

    try {
      const doc = await findSectionDoc();
      if (!doc) {
        res.json({ success: true, data: [] });
        return;
      }

      const reviews = getReviewsArray(doc).sort((a, b) => a.order - b.order);
      res.json({ success: true, data: reviews });
    } catch (err) {
      console.error("[ReviewsController.getAll]", err);
      res.status(500).json({ error: "Error al obtener reseñas" });
    }
  };

  /** POST /api/reviews — crear reseña (dashboard, multipart) */
  static create = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "Base de datos no conectada" });
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
      res.status(500).json({ error: "Error al crear reseña" });
    }
  };

  /** PUT /api/reviews/:reviewId — actualizar reseña (dashboard, multipart) */
  static update = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "Base de datos no conectada" });
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
      if (text !== undefined) reviews[idx].text = text;
      if (rating !== undefined) reviews[idx].rating = Math.max(1, Math.min(5, Number(rating) || 5));

      const files = req.files as Express.Multer.File[] | undefined;
      const avatarFile = files?.find((f) => f.fieldname === "avatar");
      if (avatarFile) {
        const uploaded = await GcsStorageService.uploadFile({
          fileBuffer: avatarFile.buffer,
          originalName: avatarFile.originalname,
          mimeType: avatarFile.mimetype,
          mediaKind: "image",
        });
        reviews[idx].avatarUrl = uploaded.url;
      }

      doc.markModified("json");
      await doc.save();

      res.json({ success: true, data: reviews[idx] });
    } catch (err) {
      console.error("[ReviewsController.update]", err);
      res.status(500).json({ error: "Error al actualizar reseña" });
    }
  };

  /** DELETE /api/reviews/:reviewId — eliminar reseña */
  static remove = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "Base de datos no conectada" });
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
      res.status(500).json({ error: "Error al eliminar reseña" });
    }
  };

  /** PATCH /api/reviews/reorder — reordenar reseñas */
  static reorder = async (req: Request, res: Response): Promise<void> => {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "Base de datos no conectada" });
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

      doc.json[REVIEWS_JSON_KEY] = reordered;
      doc.markModified("json");
      await doc.save();

      res.json({ success: true, data: reordered });
    } catch (err) {
      console.error("[ReviewsController.reorder]", err);
      res.status(500).json({ error: "Error al reordenar reseñas" });
    }
  };
}
