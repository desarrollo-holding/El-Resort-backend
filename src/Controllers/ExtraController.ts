import type { Request, Response } from "express";
import mongoose from "mongoose";
import Extra from "../models/Extras";
import { ExtrasService } from "../services/extras.service";
import { GcsStorageService } from "../services/csStorage.service";
import { InvalidImageError } from "../services/imageOptimizer";
import { uploadImageAsset } from "../services/imageAssetUpload";
import { normalizeImageAsset, normalizeImageAssetArray, type ImageAssetType } from "../models/shared/imageAsset";
import { encuadreParaImagen, parseEncuadreEntrada } from "./encuadreImagen";
import { parseIdiomaQuery } from "../utils/idioma";

import { sendErrorResponse } from "../utils/errors";
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
 * /api/extras:
 *   get:
 *     tags: [Extras]
 *     summary: Listar extras
 *     responses:
 *       200:
 *         description: Listado
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Extra' }
 *   post:
 *     tags: [Extras]
 *     summary: Crear extra
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateExtraRequest' }
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
 *
 * /api/extras/grouped:
 *   get:
 *     tags: [Extras]
 *     summary: Listar extras agrupados por grupo
 *     responses:
 *       200:
 *         description: Listado
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   grupo: { type: string, nullable: true }
 *                   extras:
 *                     type: array
 *                     items: { $ref: '#/components/schemas/Extra' }
  *
 * /api/extras/{id}:
 *   get:
 *     tags: [Extras]
 *     summary: Obtener extra por id
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Extra
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Extra' }
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
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   put:
 *     tags: [Extras]
 *     summary: Actualizar extra
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateExtraRequest' }
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
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     tags: [Extras]
 *     summary: Eliminar extra
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
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
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class ExtraController {
  //Crear Extra
  static createExtra = async (req: Request, res: Response) => {
    const uploadedFileIds: string[] = [];

    // Antes de subir nada: un encuadre ilegible es un 400, y así no queda una foto huérfana en el bucket.
    const entradaEncuadre = parseEncuadreEntrada(req.body?.encuadreImagen);
    if (entradaEncuadre.tipo === "invalido") {
      res.status(400).json({ error: entradaEncuadre.error });
      return;
    }

    try {
      const imageUrls = parseImageUrlsInput(req.body?.imagenes);
      const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
      const totalIncomingImages = imageUrls.length + files.length;

      if (totalIncomingImages > 1) {
        res.status(400).json({ error: "Solo se permite 1 imagen" });
        return;
      }

      let imagenes: ImageAssetType[] = normalizeImageAssetArray(imageUrls);
      if (totalIncomingImages === 1) {
        if (files.length === 1) {
          const file = files[0];
          const asset = await uploadImageAsset(file);
          uploadedFileIds.push(asset.storageKey);
          imagenes = [asset];
        }
      }

      // `encuadreImagen` no pasa tal cual del body: en multipart llega como texto JSON, y además hay que
      // llevarlo a la escala del archivo guardado.
      const campos = { ...(req.body ?? {}) } as Record<string, unknown>;
      delete campos.encuadreImagen;
      const extra = new Extra({
        ...campos,
        imagenes,
        encuadreImagen:
          entradaEncuadre.tipo === "fijar"
            ? encuadreParaImagen(entradaEncuadre.encuadre, entradaEncuadre.origen, imagenes[0] ?? null)
            : null,
      });
      await extra.save();
      res.send("Extra creado correctamente");
    } catch (error) {
      if (uploadedFileIds.length > 0) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      console.log(error);
      if (error instanceof InvalidImageError) {
        res.status(400).json({ message: error.message });
        return;
      }
      sendErrorResponse(res, error, "Error al crear el extra");
    }
  };

  //Obtener todos los extras
  static getAllExtras = async (req: Request, res: Response) => {
    try {
      const extras = await Extra.find({}).sort({ orden: 1 });
      res.json(extras);
    } catch (error) {
      console.log(error);
      sendErrorResponse(res, error, "Error al obtener los extras");
    }
  };

  //Obtener todos los extras agrupados por grupo
  static getExtrasGroupedByGrupo = async (_req: Request, res: Response) => {
    try {
      const idioma = parseIdiomaQuery(_req.query.idioma) ?? "es";
      const blocks = await ExtrasService.getExtrasGroupedByGrupo(idioma);
      res.json(blocks);
    } catch (error) {
      console.log(error);
      sendErrorResponse(res, error, "Error al obtener los extras por grupo");
    }
  };

  //Obtener extra por su ID
  static getExtraById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const extra = await Extra.findById(id);
      if (!extra) {
        const error = new Error("Extra no encontrado");
        res.status(404).json({ error: error.message });
        return;
      }
      res.json(extra);
    } catch (error) {
      console.log(error);
    }
  };

  //Actualizar Extra
  static updateExtra = async (req: Request, res: Response) => {
    const { id } = req.params;
    const uploadedFileIds: string[] = [];

    try {
      const imageUrls = parseImageUrlsInput(req.body?.imagenes);
      const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
      const totalIncomingImages = imageUrls.length + files.length;
      const payload = { ...req.body } as Record<string, unknown>;
      // Se resuelve aparte (ver abajo): en multipart llega como texto JSON y hay que reescalarlo.
      delete payload.encuadreImagen;
      const entradaEncuadre = parseEncuadreEntrada(req.body?.encuadreImagen);
      if (entradaEncuadre.tipo === "invalido") {
        res.status(400).json({ error: entradaEncuadre.error });
        return;
      }

      const currentExtra = await Extra.findById(id);

      if (!currentExtra) {
        const error = new Error("Extra no encontrado");
        res.status(404).json({ error: error.message });
        return;
      }

      if (totalIncomingImages > 1) {
        res.status(400).json({ error: "Solo se permite 1 imagen" });
        return;
      }

      const previousImages = normalizeImageAssetArray(currentExtra.imagenes);

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

        payload.imagenes = nextImage ? [nextImage] : [];
      }

      const fotoActual = Array.isArray(payload.imagenes)
        ? ((payload.imagenes as ImageAssetType[])[0] ?? null)
        : (previousImages[0] ?? null);
      const cambioLaFoto = (fotoActual?.url ?? null) !== (previousImages[0]?.url ?? null);
      if (entradaEncuadre.tipo === "fijar") {
        payload.encuadreImagen = encuadreParaImagen(entradaEncuadre.encuadre, entradaEncuadre.origen, fotoActual);
      } else if (entradaEncuadre.tipo === "borrar" || cambioLaFoto) {
        // Un encuadre es de una foto concreta: con otra foto, el rectángulo apuntaría a cualquier parte.
        payload.encuadreImagen = null;
      }

      // Se editó el español: la traducción vieja quedaría desactualizada, se borra y se vuelve
      // a generar sola en la próxima visita con idioma=en.
      if (typeof payload.nombre === "string" && payload.nombre !== currentExtra.nombre) {
        payload.nombreEn = null;
      }
      if (typeof payload.descripcion === "string" && payload.descripcion !== currentExtra.descripcion) {
        payload.descripcionEn = null;
      }

      const extra = await Extra.findByIdAndUpdate(id, payload, { new: true, runValidators: true });

      if (!extra) {
        const error = new Error("Extra no encontrado");
        res.status(404).json({ error: error.message });
        return;
      }

      if (totalIncomingImages === 1) {
        const currentImages = normalizeImageAssetArray(extra.imagenes);
        const staleFileIds = previousImages
          .filter((asset) => !currentImages.some((current) => current.url === asset.url))
          .map((asset) => asset.storageKey || GcsStorageService.extractKeyFromUrl(asset.url))
          .filter((value): value is string => typeof value === "string" && value.length > 0);

        if (staleFileIds.length > 0) {
          await Promise.allSettled(staleFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
        }
      }

      res.send("Extra actualizado correctamente");
    } catch (error) {
      if (uploadedFileIds.length > 0) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      console.log(error);
      if (error instanceof InvalidImageError) {
        res.status(400).json({ message: error.message });
        return;
      }
      sendErrorResponse(res, error, "Error al actualizar el extra");
    }
  };

  //Eliminar Extra
  static deleteExtra = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const extra = await Extra.findById(id);

      if (!extra) {
        const error = new Error("Extra no encontrado");
        res.status(404).json({ error: error.message });
        return;
      }

      const fileIds = normalizeImageAssetArray(extra.imagenes)
        .map((asset) => asset.storageKey || GcsStorageService.extractKeyFromUrl(asset.url))
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      await extra.deleteOne();

      if (fileIds.length > 0) {
        await Promise.allSettled(fileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      res.send("Extra eliminado correctamente");
    } catch (error) {
      console.log(error);
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

      await Extra.bulkWrite(operations, { ordered: false });
      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, error, "Error al guardar el orden de los extras");
    }
  };
}
