import type { Request, Response } from "express";
import { RetirosService } from "../services/retiros.service";

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
    try {
      const created = await RetirosService.create(req.body);
      res.status(201).json(created);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al crear el retiro" });
    }
  };

  static list = async (_req: Request, res: Response): Promise<void> => {
    try {
      const items = await RetirosService.listAll();
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
    try {
      const { id } = req.params;
      const updated = await RetirosService.updateById(id, req.body);

      if (!updated) {
        res.status(404).json({ error: "Retiro no encontrado" });
        return;
      }

      res.json(updated);
    } catch (error) {
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
