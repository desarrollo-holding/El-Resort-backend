import type { Request, Response } from "express";
import { CustomFieldsService } from "../services/customfields.service";
import { formatCloudbedsError } from "../utils/http";

import { sendErrorResponse } from "../utils/errors";
/**
 * @openapi
 * /api/customfields:
 *   get:
 *     tags: [CustomFields]
 *     summary: Listar custom fields (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: customFieldID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: shortcode
 *         required: false
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Respuesta Cloudbeds (raw JSON)
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class CustomFieldsController {
  static getCustomFields = async (req: Request, res: Response): Promise<void> => {
    try {
      const propertyID = typeof req.query.propertyID === "string" ? req.query.propertyID : undefined;
      const customFieldID = typeof req.query.customFieldID === "string" ? req.query.customFieldID : undefined;
      const shortcode = typeof req.query.shortcode === "string" ? req.query.shortcode : undefined;

      const data = await CustomFieldsService.getCustomFields({ propertyID, customFieldID, shortcode });
      res.json(data);
    } catch (error) {
      if (error instanceof CustomFieldsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      sendErrorResponse(res, error, "Error al obtener los campos personalizados");
    }
  };
}
