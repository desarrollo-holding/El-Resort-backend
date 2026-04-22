import type { Request, Response } from "express";
import mongoose from "mongoose";
import { TextosLandingPageService } from "../services/textosLandingPage.service";

const isMongoDuplicateKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === 11000;
};

/**
 * @openapi
 * /api/textos-landing-page:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [TextosLandingPage]
 *     summary: Crear texto de landing por idioma y sectionId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idioma, section, json]
 *             properties:
 *               idioma: { type: string, example: es }
 *               section: { type: string, example: 67fbe2b9f95aab97d58f4c2a, description: ID de LandingPageSection }
 *               json: { type: object, additionalProperties: true }
 *     responses:
 *       201: { description: Creado }
 *       409:
 *         description: Ya existe la combinación idioma + section
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 *   get:
 *     tags: [TextosLandingPage]
 *     summary: Obtener todos los sections por idioma
 *     parameters:
 *       - in: query
 *         name: idioma
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Objeto plano section -> json
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *             example:
 *               hero:
 *                 title: Bienvenido
 *               faq:
 *                 title: Preguntas frecuentes
 *
 * /api/textos-landing-page/section/{sectionId}/es:
 *   get:
 *     tags: [TextosLandingPage]
 *     summary: Obtener texto en idioma es por sectionId
 *     parameters:
 *       - in: path
 *         name: sectionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Registro encontrado
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 * /api/textos-landing-page/{id}:
 *   get:
 *     tags: [TextosLandingPage]
 *     summary: Obtener registro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     security: [{ bearerAuth: [] }]
 *     tags: [TextosLandingPage]
 *     summary: Actualizar parcialmente json de un registro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               json:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Patch parcial de campos dentro de json (no reemplaza todo el objeto)
 *     responses:
 *       200: { description: OK }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [TextosLandingPage]
 *     summary: Eliminar registro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class TextosLandingPageController {
  static create = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { idioma, section, json } = req.body as { idioma: string; section: string; json: unknown };
      const created = await TextosLandingPageService.create(idioma.trim(), section.trim(), json);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        res.status(409).json({ error: "Ya existe un registro para esa combinacion idioma + sectionId" });
        return;
      }
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      if (message.includes("Debes enviar") || message.includes("json debe ser")) {
        res.status(400).json({ error: message });
        return;
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { id } = req.params;
      const doc = await TextosLandingPageService.getById(id);
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data: doc });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static list = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const idioma = typeof req.query.idioma === "string" ? req.query.idioma.trim() : "";
      const data = await TextosLandingPageService.getAllSectionsByIdioma(idioma);
      res.json(data);
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static getSpanishBySectionId = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { sectionId } = req.params;
      const doc = await TextosLandingPageService.getSpanishBySectionId(sectionId);
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true, data: doc });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static updateById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { id } = req.params;
      const { json } = req.body as { json?: unknown };

      const updated = await TextosLandingPageService.updateById(id, {
        json,
      });

      if (!updated) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true, data: updated });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        res.status(409).json({ error: "Ya existe un registro para esa combinacion idioma + sectionId" });
        return;
      }

      const message = error instanceof Error ? error.message : "Error interno del servidor";
      if (message.includes("Debes enviar") || message.includes("json debe ser")) {
        res.status(400).json({ error: message });
        return;
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static deleteById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { id } = req.params;
      const ok = await TextosLandingPageService.deleteById(id);
      if (!ok) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };
}