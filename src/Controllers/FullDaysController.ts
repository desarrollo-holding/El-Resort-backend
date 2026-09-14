import type { Request, Response } from "express";
import { FullDaysService } from "../services/fullDays.service";
import { GcsStorageService } from "../services/csStorage.service";
import { InvalidImageError } from "../services/imageOptimizer";
import { parseIdiomaQuery } from "../utils/idioma";

type FullDayPayload = {
  nombre?: string;
  descripcion?: string;
  idealPara?: string;
  cuposMaximos?: number;
  imagen?: string;
  incluye?: string[];
  itinerario?: string[];
  precioPorPersona?: number;
  disponible?: boolean;
};

const asTrimmedString = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
};

/** En multipart cada campo llega como texto, así que una lista viaja serializada (`["a","b"]`). */
const asStringList = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== "string") return undefined;

  const raw = value.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
    } catch {
      // No era JSON: se trata como un único elemento suelto.
    }
  }
  return [raw];
};

const assign = <K extends keyof FullDayPayload>(
  payload: FullDayPayload,
  key: K,
  value: FullDayPayload[K] | undefined
) => {
  if (value !== undefined) payload[key] = value;
};

/** Toma solo los campos presentes en el body, ya convertidos desde texto (multipart) o JSON. */
const buildPayload = (body: Record<string, unknown>): FullDayPayload => {
  const payload: FullDayPayload = {};
  assign(payload, "nombre", asTrimmedString(body.nombre));
  assign(payload, "descripcion", asTrimmedString(body.descripcion));
  assign(payload, "idealPara", asTrimmedString(body.idealPara));
  assign(payload, "cuposMaximos", asNumber(body.cuposMaximos));
  assign(payload, "imagen", asTrimmedString(body.imagen));
  assign(payload, "incluye", asStringList(body.incluye));
  assign(payload, "itinerario", asStringList(body.itinerario));
  assign(payload, "precioPorPersona", asNumber(body.precioPorPersona));
  assign(payload, "disponible", asBoolean(body.disponible));
  return payload;
};

const firstUploadedFile = (req: Request): Express.Multer.File | null => {
  const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
  return files[0] ?? null;
};

/**
 * Perfil `single`: la card muestra la foto en un solo tamaño, así que generar la escalera de
 * variantes sería almacenamiento tirado. Devuelve la URL pública y la key para poder revertir.
 */
const uploadCardImage = async (file: Express.Multer.File) => {
  const uploaded = await GcsStorageService.uploadFile({
    fileBuffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    mediaKind: "image",
    imageProfile: "single",
  });
  return { url: uploaded.url, fileId: uploaded.storageKey ?? uploaded.fileId };
};

/**
 * @openapi
 * /api/full-days:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FullDays]
 *     summary: Crear full day
 *     description: Acepta JSON (con `imagen` como URL) o multipart/form-data (con `imagen` como archivo).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateFullDayRequest' }
 *         multipart/form-data:
 *           schema: { $ref: '#/components/schemas/CreateFullDayMultipartRequest' }
 *     responses:
 *       201:
 *         description: Full day creado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FullDay' }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationErrorResponse' }
 *       500:
 *         description: Error interno
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   get:
 *     tags: [FullDays]
 *     summary: Listar full days
 *     parameters:
 *       - in: query
 *         name: idioma
 *         schema: { type: string, enum: [es, en] }
 *     responses:
 *       200:
 *         description: Listado de full days
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/FullDay' }
 *
 * /api/full-days/{id}:
 *   get:
 *     tags: [FullDays]
 *     summary: Obtener full day por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Full day
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FullDay' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   put:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FullDays]
 *     summary: Actualizar full day por id
 *     description: Actualización parcial. Acepta JSON o multipart/form-data (con `imagen` como archivo).
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateFullDayRequest' }
 *         multipart/form-data:
 *           schema: { $ref: '#/components/schemas/CreateFullDayMultipartRequest' }
 *     responses:
 *       200:
 *         description: Full day actualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FullDay' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [FullDays]
 *     summary: Eliminar full day por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Full day eliminado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class FullDaysController {
  static create = async (req: Request, res: Response): Promise<void> => {
    const file = firstUploadedFile(req);
    let uploadedFileId: string | null = null;

    try {
      const payload = buildPayload(req.body ?? {});

      if (file) {
        const uploaded = await uploadCardImage(file);
        uploadedFileId = uploaded.fileId;
        payload.imagen = uploaded.url;
      }

      if (!payload.imagen) {
        res.status(400).json({ error: "La imagen es requerida" });
        return;
      }

      const created = await FullDaysService.create(payload);
      res.status(201).json(created);
    } catch (error) {
      // La imagen recién subida no la referencia ningún documento: se borra para no dejarla huérfana.
      if (uploadedFileId) {
        await Promise.allSettled([GcsStorageService.deleteFile({ fileId: uploadedFileId })]);
      }
      if (error instanceof InvalidImageError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Error al crear el full day" });
    }
  };

  static list = async (req: Request, res: Response): Promise<void> => {
    try {
      const idioma = parseIdiomaQuery(req.query.idioma) ?? "es";
      const items = await FullDaysService.listAll(idioma);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al listar full days" });
    }
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const item = await FullDaysService.getById(id);

      if (!item) {
        res.status(404).json({ error: "Full day no encontrado" });
        return;
      }

      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener el full day" });
    }
  };

  static updateById = async (req: Request, res: Response): Promise<void> => {
    const file = firstUploadedFile(req);
    let uploadedFileId: string | null = null;

    try {
      const { id } = req.params;
      const payload = buildPayload(req.body ?? {});

      if (file) {
        const uploaded = await uploadCardImage(file);
        uploadedFileId = uploaded.fileId;
        payload.imagen = uploaded.url;
      }

      // La imagen anterior no se borra del bucket: el admin puede haberla elegido de la galería
      // existente, donde la misma URL puede estar referenciada por otra sección.
      const updated = await FullDaysService.updateById(id, payload);

      if (!updated) {
        if (uploadedFileId) {
          await Promise.allSettled([GcsStorageService.deleteFile({ fileId: uploadedFileId })]);
        }
        res.status(404).json({ error: "Full day no encontrado" });
        return;
      }

      res.json(updated);
    } catch (error) {
      if (uploadedFileId) {
        await Promise.allSettled([GcsStorageService.deleteFile({ fileId: uploadedFileId })]);
      }
      if (error instanceof InvalidImageError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Error al actualizar el full day" });
    }
  };

  static deleteById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const deleted = await FullDaysService.deleteById(id);

      if (!deleted) {
        res.status(404).json({ error: "Full day no encontrado" });
        return;
      }

      res.json({ message: "Full day eliminado correctamente" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al eliminar el full day" });
    }
  };
}
