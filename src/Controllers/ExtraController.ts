import type { Request, Response } from "express";
import Extra from "../models/Extras";
import { ExtrasService } from "../services/extras.service";
import { SupabaseStorageService } from "../services/supabaseStorage.service";

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
    const extra = new Extra(req.body);

    try {
      await extra.save();
      res.send("Extra creado correctamente");
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error al crear el extra", error });
    }
  };

  //Obtener todos los extras
  static getAllExtras = async (req: Request, res: Response) => {
    try {
      const extras = await Extra.find({});
      res.json(extras);
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error al crear el extra", error });
    }
  };

  //Obtener todos los extras agrupados por grupo
  static getExtrasGroupedByGrupo = async (_req: Request, res: Response) => {
    try {
      const blocks = await ExtrasService.getExtrasGroupedByGrupo();
      res.json(blocks);
    } catch (error) {
      console.log(error);
      res.status(500).json({ message: "Error al obtener los extras", error });
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

        payload.imagenes = nextImageUrl ? [nextImageUrl] : [];
      }

      const extra = await Extra.findByIdAndUpdate(id, payload, { new: true, runValidators: true });

      if (!extra) {
        const error = new Error("Extra no encontrado");
        res.status(404).json({ error: error.message });
        return;
      }

      if (totalIncomingImages === 1) {
        const previousImages = Array.isArray(currentExtra.imagenes) ? currentExtra.imagenes : [];
        const currentImage = Array.isArray(extra.imagenes) ? extra.imagenes[0] : undefined;
        const staleFileIds = previousImages
          .filter((url) => url !== currentImage)
          .map((url) => extractSupabaseFileIdFromPublicUrl(url))
          .filter((value): value is string => typeof value === "string" && value.length > 0);

        if (staleFileIds.length > 0) {
          await Promise.allSettled(staleFileIds.map((fileId) => SupabaseStorageService.deleteFile({ fileId })));
        }
      }

      res.send("Extra actualizado correctamente");
    } catch (error) {
      if (uploadedFileIds.length > 0) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => SupabaseStorageService.deleteFile({ fileId })));
      }

      console.log(error);
      res.status(500).json({ message: "Error al actualizar el extra" });
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

      await extra.deleteOne();
      res.send("Extra eliminado correctamente");
    } catch (error) {
      console.log(error);
    }
  };
}
