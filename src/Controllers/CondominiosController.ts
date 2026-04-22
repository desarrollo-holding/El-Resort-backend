import type { Request, Response } from "express";
import mongoose from "mongoose";
import { CondominiosService } from "../services/condominios.service";
import { SupabaseStorageService } from "../services/supabaseStorage.service";

/**
 * @openapi
 * /api/condominios:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Condominios]
 *     summary: Crear un condominio
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name, map_url]
 *             properties:
 *               name: { type: string }
 *               map_url:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Creado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string }
 *                     mapUrl: { type: string, nullable: true }
 *   get:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Condominios]
 *     summary: Listar condominios
 *     responses:
 *       200:
 *         description: OK
 * /api/condominios/{id}:
 *   get:
 *     tags: [Condominios]
 *     summary: Obtener condominio por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *   put:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Condominios]
 *     summary: Actualizar condominio por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name, map_url]
 *             properties:
 *               name: { type: string }
 *               map_url:
 *                 type: string
 *                 format: binary
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Condominios]
 *     summary: Eliminar condominio por id
 */

export class CondominiosController {
  static create = async (req: Request, res: Response): Promise<void> => {
    let uploadedFileId: string | undefined;

    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { name } = req.body as { name: string };
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "El campo name es requerido" });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "El archivo map_url es requerido" });
        return;
      }

      if (!file.mimetype?.startsWith("image/")) {
        res.status(400).json({ error: "map_url debe ser una imagen" });
        return;
      }

      const uploaded = await SupabaseStorageService.uploadFile({
        fileBuffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
      });
      uploadedFileId = uploaded.fileId;

      const created = await CondominiosService.create(name.trim(), uploaded.url);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (uploadedFileId) {
        await Promise.allSettled([SupabaseStorageService.deleteFile({ fileId: uploadedFileId })]);
      }

      if (error && typeof error === "object" && (error as any).code === 11000) {
        res.status(409).json({ error: "Ya existe un condominio con ese nombre" });
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
      const doc = await CondominiosService.getById(id);
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data: doc });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static list = async (_req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }
      const list = await CondominiosService.listAll();
      res.json({ success: true, data: list });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static updateById = async (req: Request, res: Response): Promise<void> => {
    let uploadedFileId: string | undefined;

    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { id } = req.params;
      const { name } = req.body as { name?: string };
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "El campo name es requerido" });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "El archivo map_url es requerido" });
        return;
      }

      if (!file.mimetype?.startsWith("image/")) {
        res.status(400).json({ error: "map_url debe ser una imagen" });
        return;
      }

      const uploaded = await SupabaseStorageService.uploadFile({
        fileBuffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
      });
      uploadedFileId = uploaded.fileId;

      const updated = await CondominiosService.updateById(id, name.trim(), uploaded.url);
      if (!updated) {
        if (uploadedFileId) {
          await Promise.allSettled([SupabaseStorageService.deleteFile({ fileId: uploadedFileId })]);
        }
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data: updated });
    } catch (error) {
      if (uploadedFileId) {
        await Promise.allSettled([SupabaseStorageService.deleteFile({ fileId: uploadedFileId })]);
      }

      if (error && typeof error === "object" && (error as any).code === 11000) {
        res.status(409).json({ error: "Ya existe un condominio con ese nombre" });
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
      const ok = await CondominiosService.deleteById(id);
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
