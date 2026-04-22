import type { Request, Response } from "express";
import mongoose from "mongoose";
import { LandingPageSectionsService } from "../services/landingPageSections.service";

const isMongoDuplicateKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === 11000;
};

/**
 * @openapi
 * /api/landing-page-sections:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [LandingPageSections]
 *     summary: Crear sección para landing page
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: hero }
 *     responses:
 *       201: { description: Creado }
 *       409:
 *         description: Ya existe una sección con ese nombre
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 *   get:
 *     tags: [LandingPageSections]
 *     summary: Listar secciones de landing page
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       name: { type: string }
 */
export class LandingPageSectionsController {
  static create = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { name } = req.body as { name: string };
      const created = await LandingPageSectionsService.create(name.trim());
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        res.status(409).json({ error: "Ya existe una sección con ese nombre" });
        return;
      }
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static list = async (_req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const list = await LandingPageSectionsService.listAll();
      res.json({ success: true, data: list });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };
}