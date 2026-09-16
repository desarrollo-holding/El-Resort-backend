import type { Request, Response } from "express";
import mongoose from "mongoose";
import { BeneficiosService, type BeneficioIconFile } from "../services/beneficios.service";
import { InvalidImageError } from "../services/imageOptimizer";

import { sendErrorResponse } from "../utils/errors";
/** El icono llega como `icono` en un multipart (`upload.any()` en las rutas). */
const pickIconFile = (req: Request): BeneficioIconFile | undefined => {
  const files = req.files as Express.Multer.File[] | undefined;
  const file = files?.find((f) => f.fieldname === "icono");
  if (!file) return undefined;
  return { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype };
};

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
};

export class BeneficiosController {
  /**
   * @openapi
   * /api/beneficios:
   *   get:
   *     tags: [Beneficios]
   *     summary: Listar el catálogo de beneficios incluidos
   *     parameters:
   *       - in: query
   *         name: includeInactive
   *         schema: { type: boolean }
   *         description: Incluye los desactivados. Requiere token de marketing.
   *     responses:
   *       200:
   *         description: Catálogo ordenado por `orden`
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
   *                       _id: { type: string }
   *                       nombre:
   *                         type: object
   *                         properties:
   *                           es: { type: string }
   *                           en: { type: string, nullable: true }
   *                       iconUrl: { type: string }
   *                       orden: { type: integer }
   *                       isActive: { type: boolean }
   */
  static list = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }
      // Solo un usuario autenticado de marketing puede ver los desactivados.
      const wantsInactive = parseBoolean((req.query as Record<string, unknown>).includeInactive) === true;
      const includeInactive = wantsInactive && req.user?.rol === "marketing";

      const data = await BeneficiosService.list({ includeInactive });
      res.json({ success: true, data });
    } catch (error) {
      console.error("[BeneficiosController.list]", error);
      sendErrorResponse(res, error, "Error al obtener los beneficios");
    }
  };

  /**
   * @openapi
   * /api/beneficios:
   *   post:
   *     security: [{ bearerAuth: [] }]
   *     tags: [Beneficios]
   *     summary: Crear un beneficio (icono + texto)
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [nombreEs, icono]
   *             properties:
   *               nombreEs: { type: string }
   *               nombreEn: { type: string, description: "Opcional; si se omite lo resuelve el traductor" }
   *               orden: { type: integer }
   *               isActive: { type: boolean }
   *               icono:
   *                 type: string
   *                 format: binary
   *     responses:
   *       201: { description: Creado }
   *       400: { description: Falta el nombre o el icono }
   */
  static create = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const nombreEs = typeof body.nombreEs === "string" ? body.nombreEs.trim() : "";
      if (!nombreEs) {
        res.status(400).json({ error: "nombreEs es requerido" });
        return;
      }

      const icon = pickIconFile(req);
      if (!icon) {
        res.status(400).json({ error: "icono es requerido" });
        return;
      }

      const data = await BeneficiosService.create(
        {
          nombreEs,
          nombreEn: typeof body.nombreEn === "string" ? body.nombreEn.trim() : null,
          orden: parseNumber(body.orden),
          isActive: parseBoolean(body.isActive),
        },
        icon
      );

      res.status(201).json({ success: true, data });
    } catch (error) {
      console.error("[BeneficiosController.create]", error);
      if (error instanceof InvalidImageError) {
        res.status(400).json({ error: error.message });
        return;
      }
      sendErrorResponse(res, error, "Error al crear el beneficio");
    }
  };

  /**
   * @openapi
   * /api/beneficios/{id}:
   *   put:
   *     security: [{ bearerAuth: [] }]
   *     tags: [Beneficios]
   *     summary: Actualizar un beneficio; el icono es opcional
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               nombreEs: { type: string }
   *               nombreEn: { type: string }
   *               orden: { type: integer }
   *               isActive: { type: boolean }
   *               icono:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200: { description: Actualizado }
   *       404: { description: No encontrado }
   */
  static update = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const data = await BeneficiosService.update(
        req.params.id,
        {
          nombreEs: typeof body.nombreEs === "string" ? body.nombreEs.trim() : undefined,
          nombreEn: typeof body.nombreEn === "string" ? body.nombreEn.trim() : undefined,
          orden: parseNumber(body.orden),
          isActive: parseBoolean(body.isActive),
        },
        pickIconFile(req)
      );

      if (!data) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data });
    } catch (error) {
      console.error("[BeneficiosController.update]", error);
      if (error instanceof InvalidImageError) {
        res.status(400).json({ error: error.message });
        return;
      }
      sendErrorResponse(res, error, "Error al actualizar el beneficio");
    }
  };

  /**
   * @openapi
   * /api/beneficios/reorder:
   *   put:
   *     security: [{ bearerAuth: [] }]
   *     tags: [Beneficios]
   *     summary: Reordenar el catálogo
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: array
   *             items:
   *               type: object
   *               required: [_id, orden]
   *               properties:
   *                 _id: { type: string }
   *                 orden: { type: integer }
   *     responses:
   *       200: { description: Reordenado }
   */
  static reorder = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const body = req.body;
      if (!Array.isArray(body)) {
        res.status(400).json({ error: "body debe ser un array" });
        return;
      }

      const items = body
        .map((it: unknown) => {
          const rec = it as Record<string, unknown>;
          const _id = typeof rec?._id === "string" ? rec._id : "";
          const orden = parseNumber(rec?.orden);
          return _id && orden !== undefined ? { _id, orden } : null;
        })
        .filter((it): it is { _id: string; orden: number } => it !== null);

      const modified = await BeneficiosService.reorder(items);
      res.json({ success: true, data: { modified } });
    } catch (error) {
      console.error("[BeneficiosController.reorder]", error);
      sendErrorResponse(res, error, "Error al guardar el orden de los beneficios");
    }
  };

  /**
   * @openapi
   * /api/beneficios/{id}:
   *   delete:
   *     security: [{ bearerAuth: [] }]
   *     tags: [Beneficios]
   *     summary: Eliminar un beneficio, su icono y la referencia en todas las propiedades
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Eliminado }
   *       404: { description: No encontrado }
   */
  static remove = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const ok = await BeneficiosService.remove(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error("[BeneficiosController.remove]", error);
      sendErrorResponse(res, error, "Error al eliminar el beneficio");
    }
  };
}
