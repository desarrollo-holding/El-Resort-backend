import type { Request, Response } from "express";
import mongoose from "mongoose";
import Area, { AREA_CATEGORIAS } from "../models/Area";
import { SupabaseStorageService } from "../services/supabaseStorage.service";
import { asOptionalString } from "../utils/http";

const extractSupabaseFileIdFromPublicUrl = (value: string): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const parsed = new URL(value);
    const marker = "/storage/v1/object/public/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const suffix = parsed.pathname.slice(markerIndex + marker.length);
    const firstSlash = suffix.indexOf("/");
    if (firstSlash < 0) return null;

    const fileId = decodeURIComponent(suffix.slice(firstSlash + 1));
    return fileId || null;
  } catch {
    return null;
  }
};

const parseImagesToDelete = (body: unknown): string[] => {
  if (!body || typeof body !== "object") return [];

  const input = body as { imagen?: unknown; imagenes?: unknown };
  const values: string[] = [];

  if (typeof input.imagen === "string" && input.imagen.trim()) {
    values.push(input.imagen.trim());
  }

  if (Array.isArray(input.imagenes)) {
    for (const item of input.imagenes) {
      if (typeof item === "string" && item.trim()) values.push(item.trim());
    }
  }

  return Array.from(new Set(values));
};

const parseImageUrlsInput = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))
    );
  }

  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return Array.from(
        new Set(parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))
      );
    }
  } catch {
    // If it's not JSON, treat it as a single URL string.
  }

  return [trimmed];
};

/**
 * @openapi
 * /api/areas:
 *   get:
 *     tags: [Areas]
 *     summary: Listar áreas
 *     parameters:
 *       - in: query
 *         name: categoria
 *         required: false
 *         schema:
 *           type: string
 *           enum: [AREAS, ACTIVIDADES_GRUPALES]
 *     responses:
 *       200:
 *         description: Listado
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Area' }
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Areas]
 *     summary: Crear área
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateAreaRequest' }
 *     responses:
 *       200: { description: OK }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationErrorResponse' }
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 * /api/areas/{id}:
 *   get:
 *     tags: [Areas]
 *     summary: Obtener área por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Area' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       503:
 *         description: Base de datos no conectada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Areas]
 *     summary: Actualizar área por id (nombre y/o nuevas imágenes)
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
 *             properties:
 *               nombre: { type: string }
 *               imagenes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Area' }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 * /api/areas/{id}/imagenes:
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Areas]
 *     summary: Eliminar una o más imágenes de un área
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
 *               imagen: { type: string }
 *               imagenes:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 removed: { type: number }
 *                 data: { $ref: '#/components/schemas/Area' }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class AreaController {
  static getAllAreas = async (_req: Request, res: Response) => {
    try {
      const categoria = asOptionalString(_req.query.categoria);
      if (categoria && !AREA_CATEGORIAS.includes(categoria as (typeof AREA_CATEGORIAS)[number])) {
        res.status(400).json({ error: "Categoría inválida" });
        return;
      }

      const filter = categoria ? { categoria } : {};
      const areas = await Area.find(filter).lean();
      res.json(areas);
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error al obtener las áreas", error });
    }
  };

  static createArea = async (req: Request, res: Response) => {
    const { nombre, descripcion, imagenes, categoria } = req.body as { nombre?: unknown; descripcion?: unknown; imagenes?: unknown; categoria?: unknown };

    const area = new Area({
      nombre,
      descripcion: typeof descripcion === "string" ? descripcion : "",
      categoria,
      imagenes: Array.isArray(imagenes) ? imagenes : [],
    });

    try {
      await area.save();
      res.send("Área creada correctamente");
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error al crear el área", error });
    }
  };

  static getAreaById = async (req: Request, res: Response) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { id } = req.params;
      const area = await Area.findById(id).lean();
      if (!area) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true, data: area });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static patchAreaById = async (req: Request, res: Response) => {
    const uploadedFileIds: string[] = [];

    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { id } = req.params;
      const nombre = typeof req.body?.nombre === "string" ? req.body.nombre.trim() : "";
      const descripcion = typeof req.body?.descripcion === "string" ? req.body.descripcion.trim() : undefined;
      const imageUrls = parseImageUrlsInput(req.body?.imagenes);
      const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
      const totalIncomingImages = imageUrls.length + files.length;

      if (!nombre && descripcion === undefined && imageUrls.length === 0 && files.length === 0) {
        res.status(400).json({ error: "Debes enviar nombre, descripcion y/o imagenes (url o archivo)" });
        return;
      }

      if (totalIncomingImages > 1) {
        res.status(400).json({ error: "Solo se permite 1 imagen" });
        return;
      }

      const area = await Area.findById(id);
      if (!area) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      if (nombre) {
        area.nombre = nombre;
      }

      if (descripcion !== undefined) {
        area.descripcion = descripcion;
      }

      const previousImages = Array.isArray(area.imagenes) ? area.imagenes : [];

      if (totalIncomingImages === 1) {
        let nextImageUrl = imageUrls[0];

        if (files.length === 1) {
          const file = files[0];
          const uploaded = await SupabaseStorageService.uploadFile({
            fileBuffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            mediaKind: "image",
          });

          uploadedFileIds.push(uploaded.fileId);
          nextImageUrl = uploaded.url;
        }

        area.imagenes = nextImageUrl ? [nextImageUrl] : [];
      }

      await area.save();

      if (totalIncomingImages === 1) {
        const currentImage = area.imagenes[0];
        const staleFileIds = previousImages
          .filter((url) => url !== currentImage)
          .map((url) => extractSupabaseFileIdFromPublicUrl(url))
          .filter((value): value is string => typeof value === "string" && value.length > 0);

        if (staleFileIds.length > 0) {
          await Promise.allSettled(staleFileIds.map((fileId) => SupabaseStorageService.deleteFile({ fileId })));
        }
      }

      res.json({ success: true, data: area });
    } catch (_error) {
      if (uploadedFileIds.length > 0) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => SupabaseStorageService.deleteFile({ fileId })));
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static deleteAreaImagesById = async (req: Request, res: Response) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { id } = req.params;
      const imagesToDelete = parseImagesToDelete(req.body);

      if (imagesToDelete.length === 0) {
        res.status(400).json({ error: "Debes enviar imagen o imagenes[]" });
        return;
      }

      const area = await Area.findById(id);
      if (!area) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      const existing = Array.isArray(area.imagenes) ? area.imagenes : [];
      const removeSet = new Set(imagesToDelete);
      const remaining = existing.filter((url) => !removeSet.has(url));

      if (remaining.length === existing.length) {
        res.status(400).json({ error: "Ninguna imagen coincide con el area" });
        return;
      }

      area.imagenes = remaining;
      await area.save();

      const fileIds = imagesToDelete
        .map((url) => extractSupabaseFileIdFromPublicUrl(url))
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      if (fileIds.length > 0) {
        await Promise.allSettled(fileIds.map((fileId) => SupabaseStorageService.deleteFile({ fileId })));
      }

      res.json({
        success: true,
        data: area,
        removed: existing.length - remaining.length,
      });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };
}
