import type { Request, Response } from "express";
import mongoose from "mongoose";
import Area, { AREA_CATEGORIAS } from "../models/Area";
import { GcsStorageService } from "../services/csStorage.service";
import { InvalidImageError } from "../services/imageOptimizer";
import { uploadImageAsset } from "../services/imageAssetUpload";
import { normalizeImageAsset, normalizeImageAssetArray, type ImageAssetType } from "../models/shared/imageAsset";
import { asOptionalString } from "../utils/http";
import { parseIdiomaQuery } from "../utils/idioma";
import { TranslateService } from "../services/translate.service";

import { sendErrorResponse } from "../utils/errors";
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
      const areas = await Area.find(filter).sort({ orden: 1 }).lean();

      const idioma = parseIdiomaQuery(_req.query.idioma) ?? "es";
      if (idioma === "en") {
        const [changedNombre, changedDescripcion] = await Promise.all([
          TranslateService.backfillEnglishField(areas, "nombre", "nombreEn"),
          TranslateService.backfillEnglishField(areas, "descripcion", "descripcionEn"),
        ]);
        const ops = [
          ...TranslateService.buildSetOps(changedNombre, "nombreEn"),
          ...TranslateService.buildSetOps(changedDescripcion, "descripcionEn"),
        ];
        // La persistencia es best-effort a propósito: si el bulkWrite falla, la respuesta YA está
        // traducida en memoria y el visitante la recibe igual. Dejarlo sin capturar convertía un
        // fallo de escritura en un 500 permanente para toda la web en inglés.
        if (ops.length > 0) {
          try {
            await Area.bulkWrite(ops, { ordered: false });
          } catch (error) {
            console.error("[Area] no se pudo persistir la traduccion al ingles:", error);
          }
        }
      }

      const data =
        idioma === "en"
          ? areas.map((a) => ({ ...a, nombre: a.nombreEn || a.nombre, descripcion: a.descripcionEn || a.descripcion }))
          : areas;

      res.json(data);
    } catch (error) {
      console.log(error);
      sendErrorResponse(res, error, "Error al obtener las áreas");
    }
  };

  static createArea = async (req: Request, res: Response) => {
    const { nombre, descripcion, categoria } = req.body as { nombre?: unknown; descripcion?: unknown; categoria?: unknown };
    const imageUrls = parseImageUrlsInput(req.body?.imagenes);
    const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];

    let uploadedFileId: string | null = null;

    try {
      let imagenes: ImageAssetType[] = normalizeImageAssetArray(imageUrls);

      if (files.length === 1) {
        const file = files[0];
        const asset = await uploadImageAsset(file);
        uploadedFileId = asset.storageKey;
        imagenes = [asset];
      }

      const area = new Area({
        nombre,
        descripcion: typeof descripcion === "string" ? descripcion : "",
        categoria,
        imagenes,
      });

      await area.save();
      res.status(201).json({ success: true, data: area });
    } catch (error) {
      if (uploadedFileId) {
        await Promise.allSettled([GcsStorageService.deleteFile({ fileId: uploadedFileId })]);
      }
      if (error instanceof InvalidImageError) {
        res.status(400).json({ error: error.message });
        return;
      }
      sendErrorResponse(res, error, "Error al crear el área");
    }
  };

  static getAreaById = async (req: Request, res: Response) => {
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
      const area = await Area.findById(id).lean();
      if (!area) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true, data: area });
    } catch (error) {
      sendErrorResponse(res, error, "Error al obtener el área");
    }
  };

  static patchAreaById = async (req: Request, res: Response) => {
    const uploadedFileIds: string[] = [];

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

      // Se edita el español: la traducción vieja quedaría desactualizada, se borra y se vuelve
      // a generar sola en la próxima visita con idioma=en.
      if (nombre && nombre !== area.nombre) {
        area.nombre = nombre;
        area.nombreEn = null;
      }

      if (descripcion !== undefined && descripcion !== area.descripcion) {
        area.descripcion = descripcion;
        area.descripcionEn = null;
      }

      const previousImages = normalizeImageAssetArray(area.imagenes);

      if (totalIncomingImages === 1) {
        let nextImage: ImageAssetType | null = imageUrls[0]
          ? previousImages.find((asset) => asset.url === imageUrls[0]) ?? normalizeImageAsset(imageUrls[0])
          : null;

        if (files.length === 1) {
          const file = files[0];
          const asset = await uploadImageAsset(file);
          uploadedFileIds.push(asset.storageKey);
          nextImage = asset;
        }

        area.imagenes = nextImage ? [nextImage] : [];
      }

      await area.save();

      if (totalIncomingImages === 1) {
        const currentImages = normalizeImageAssetArray(area.imagenes);
        const staleFileIds = previousImages
          .filter((asset) => !currentImages.some((current) => current.url === asset.url))
          .map((asset) => asset.storageKey || GcsStorageService.extractKeyFromUrl(asset.url))
          .filter((value): value is string => typeof value === "string" && value.length > 0);

        if (staleFileIds.length > 0) {
          await Promise.allSettled(staleFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
        }
      }

      res.json({ success: true, data: area });
    } catch (error) {
      if (uploadedFileIds.length > 0) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      if (error instanceof InvalidImageError) {
        res.status(400).json({ error: error.message });
        return;
      }
      sendErrorResponse(res, error, "Error al actualizar el área");
    }
  };

  static deleteAreaImagesById = async (req: Request, res: Response) => {
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

      const existing = normalizeImageAssetArray(area.imagenes);
      const removeSet = new Set(imagesToDelete);
      const remaining = existing.filter((asset) => !removeSet.has(asset.url));

      if (remaining.length === existing.length) {
        res.status(400).json({ error: "Ninguna imagen coincide con el area" });
        return;
      }

      area.imagenes = remaining;
      await area.save();

      const removed = existing.filter((asset) => removeSet.has(asset.url));
      const fileIds = removed
        .map((asset) => asset.storageKey || GcsStorageService.extractKeyFromUrl(asset.url))
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      if (fileIds.length > 0) {
        await Promise.allSettled(fileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      res.json({
        success: true,
        data: area,
        removed: existing.length - remaining.length,
      });
    } catch (error) {
      sendErrorResponse(res, error, "Error al eliminar las imágenes del área");
    }
  };

  static deleteArea = async (req: Request, res: Response) => {
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
      const area = await Area.findById(id);
      if (!area) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      const fileIds = normalizeImageAssetArray(area.imagenes)
        .map((asset) => asset.storageKey || GcsStorageService.extractKeyFromUrl(asset.url))
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      await Area.deleteOne({ _id: id });

      if (fileIds.length > 0) {
        await Promise.allSettled(fileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, error, "Error al eliminar el área");
    }
  };

  /** Reordena en cascada: aplica el `orden` recibido a cada id y no toca los que no vienen en la lista. */
  static updateOrderBulk = async (req: Request, res: Response) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const payload = req.body as Array<{ id?: unknown; orden?: unknown }>;
      if (!Array.isArray(payload) || payload.length === 0) {
        res.status(400).json({ error: "Debe enviar un array con objetos { id, orden }" });
        return;
      }

      const operations = payload
        .filter(
          (item): item is { id: string; orden: number } =>
            !!item && typeof item.id === "string" && Number.isInteger(item.orden)
        )
        .map((item) => ({
          updateOne: { filter: { _id: item.id }, update: { $set: { orden: item.orden } } },
        }));

      if (operations.length === 0) {
        res.status(400).json({ error: "No hay elementos válidos para actualizar" });
        return;
      }

      await Area.bulkWrite(operations, { ordered: false });
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, error, "Error al guardar el orden de las áreas");
    }
  };
}
