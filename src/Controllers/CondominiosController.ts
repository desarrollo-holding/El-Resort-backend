import type { Request, Response } from "express";
import mongoose from "mongoose";
import { CondominiosService } from "../services/condominios.service";
import { GcsStorageService } from "../services/csStorage.service";
import { InvalidImageError } from "../services/imageOptimizer";

import { sendErrorResponse } from "../utils/errors";
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
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
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

      const uploaded = await GcsStorageService.uploadFile({
        fileBuffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        mediaKind: "image",
      });
      uploadedFileId = uploaded.fileId;

      const created = await CondominiosService.create(name.trim(), uploaded.url);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (uploadedFileId) {
        await Promise.allSettled([GcsStorageService.deleteFile({ fileId: uploadedFileId })]);
      }

      if (error && typeof error === "object" && (error as any).code === 11000) {
        res.status(409).json({ error: "Ya existe un condominio con ese nombre" });
        return;
      }
      if (error instanceof InvalidImageError) {
        res.status(400).json({ error: error.message });
        return;
      }
      sendErrorResponse(res, error, "Error al crear el condominio");
    }
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const { id } = req.params;
      const doc = await CondominiosService.getById(id);
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data: doc });
    } catch (error) {
      sendErrorResponse(res, error, "Error al obtener el condominio");
    }
  };

  static list = async (_req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }
      const list = await CondominiosService.listAll();
      res.json({ success: true, data: list });
    } catch (error) {
      sendErrorResponse(res, error, "Error al obtener los condominios");
    }
  };

  static updateById = async (req: Request, res: Response): Promise<void> => {
    let uploadedFileId: string | undefined;

    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
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

      const uploaded = await GcsStorageService.uploadFile({
        fileBuffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        mediaKind: "image",
      });
      uploadedFileId = uploaded.fileId;

      const updated = await CondominiosService.updateById(id, name.trim(), uploaded.url);
      if (!updated) {
        if (uploadedFileId) {
          await Promise.allSettled([GcsStorageService.deleteFile({ fileId: uploadedFileId })]);
        }
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data: updated });
    } catch (error) {
      if (uploadedFileId) {
        await Promise.allSettled([GcsStorageService.deleteFile({ fileId: uploadedFileId })]);
      }

      if (error && typeof error === "object" && (error as any).code === 11000) {
        res.status(409).json({ error: "Ya existe un condominio con ese nombre" });
        return;
      }
      if (error instanceof InvalidImageError) {
        res.status(400).json({ error: error.message });
        return;
      }
      sendErrorResponse(res, error, "Error al actualizar el condominio");
    }
  };

  static deleteById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const { id } = req.params;
      const ok = await CondominiosService.deleteById(id);
      if (!ok) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, error, "Error al eliminar el condominio");
    }
  };
}
