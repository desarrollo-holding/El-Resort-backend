import type { Request, Response } from "express";
import { RetirosService } from "../services/retiros.service";
import { GcsStorageService } from "../services/csStorage.service";
import { InvalidImageError } from "../services/imageOptimizer";
import { parseIdiomaQuery } from "../utils/idioma";

type RetiroIncluye = {
  yoga: boolean;
  comidasPorDia: number;
  masajesIncluidos: boolean;
  trasladoIncluido: boolean;
};

type RetiroActividad = { dia: number; actividadesDelDia: string[] };

type RetiroPayload = {
  nombre?: string;
  descripcion?: string;
  idealPara?: string;
  duracionNoches?: number;
  fechaInicio?: Date;
  fechaFin?: Date;
  cuposMaximos?: number;
  imagen?: string;
  incluye?: RetiroIncluye;
  actividades?: RetiroActividad[];
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

const asDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

/** En multipart todo campo compuesto llega como texto, así que se intenta parsear primero. */
const asParsedJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];

const asIncluye = (value: unknown): RetiroIncluye | undefined => {
  const parsed = asParsedJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

  const source = parsed as Record<string, unknown>;
  return {
    yoga: asBoolean(source.yoga) ?? false,
    comidasPorDia: asNumber(source.comidasPorDia) ?? 0,
    masajesIncluidos: asBoolean(source.masajesIncluidos) ?? false,
    trasladoIncluido: asBoolean(source.trasladoIncluido) ?? false,
  };
};

const asActividades = (value: unknown): RetiroActividad[] | undefined => {
  const parsed = asParsedJson(value);
  if (!Array.isArray(parsed)) return undefined;

  return parsed
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const source = item as Record<string, unknown>;
      const actividadesDelDia = asStringList(source.actividadesDelDia);
      if (actividadesDelDia.length === 0) return null;
      return { dia: asNumber(source.dia) ?? index + 1, actividadesDelDia };
    })
    .filter((item): item is RetiroActividad => item !== null);
};

const assign = <K extends keyof RetiroPayload>(
  payload: RetiroPayload,
  key: K,
  value: RetiroPayload[K] | undefined
) => {
  if (value !== undefined) payload[key] = value;
};

/** Toma solo los campos presentes en el body, ya convertidos desde texto (multipart) o JSON. */
const buildPayload = (body: Record<string, unknown>): RetiroPayload => {
  const payload: RetiroPayload = {};
  assign(payload, "nombre", asTrimmedString(body.nombre));
  assign(payload, "descripcion", asTrimmedString(body.descripcion));
  assign(payload, "idealPara", asTrimmedString(body.idealPara));
  assign(payload, "duracionNoches", asNumber(body.duracionNoches));
  assign(payload, "fechaInicio", asDate(body.fechaInicio));
  assign(payload, "fechaFin", asDate(body.fechaFin));
  assign(payload, "cuposMaximos", asNumber(body.cuposMaximos));
  assign(payload, "imagen", asTrimmedString(body.imagen));
  assign(payload, "incluye", asIncluye(body.incluye));
  assign(payload, "actividades", asActividades(body.actividades));
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
 * /api/retiros:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Retiros]
 *     summary: Crear retiro
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateRetiroRequest' }
 *     responses:
 *       201:
 *         description: Retiro creado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Retiro' }
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
 *     tags: [Retiros]
 *     summary: Listar retiros
 *     responses:
 *       200:
 *         description: Listado de retiros
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Retiro' }
 *
 * /api/retiros/{id}:
 *   get:
 *     tags: [Retiros]
 *     summary: Obtener retiro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Retiro
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Retiro' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   put:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Retiros]
 *     summary: Actualizar retiro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateRetiroRequest' }
 *     responses:
 *       200:
 *         description: Retiro actualizado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Retiro' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [Retiros]
 *     summary: Eliminar retiro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Retiro eliminado
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
export class RetirosController {
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

      const created = await RetirosService.create(payload);
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
      res.status(500).json({ error: "Error al crear el retiro" });
    }
  };

  static list = async (req: Request, res: Response): Promise<void> => {
    try {
      const idioma = parseIdiomaQuery(req.query.idioma) ?? "es";
      const items = await RetirosService.listAll(idioma);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al listar retiros" });
    }
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const item = await RetirosService.getById(id);

      if (!item) {
        res.status(404).json({ error: "Retiro no encontrado" });
        return;
      }

      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al obtener el retiro" });
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
      const updated = await RetirosService.updateById(id, payload);

      if (!updated) {
        if (uploadedFileId) {
          await Promise.allSettled([GcsStorageService.deleteFile({ fileId: uploadedFileId })]);
        }
        res.status(404).json({ error: "Retiro no encontrado" });
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
      res.status(500).json({ error: "Error al actualizar el retiro" });
    }
  };

  static deleteById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const deleted = await RetirosService.deleteById(id);

      if (!deleted) {
        res.status(404).json({ error: "Retiro no encontrado" });
        return;
      }

      res.json({ message: "Retiro eliminado correctamente" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al eliminar el retiro" });
    }
  };
}
