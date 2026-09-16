import type { Request, Response } from "express";
import { TaxesService } from "../services/taxes.service";
import { asOptionalBoolean, asOptionalString, formatCloudbedsError } from "../utils/http";

import { sendErrorResponse } from "../utils/errors";
/**
 * @openapi
 * /api/taxes:
 *   get:
 *     tags: [Taxes]
 *     summary: Listar taxes and fees (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: includeDeleted
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: includeExpired
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: includeCustomItemTaxes
 *         required: false
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Respuesta Cloudbeds (raw JSON)
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class TaxesController {
  static getTaxesAndFees = async (req: Request, res: Response): Promise<void> => {
    try {
      const includeDeleted = asOptionalBoolean(req.query.includeDeleted) === true ? true : undefined;
      const includeExpired = asOptionalBoolean(req.query.includeExpired) === true ? true : undefined;
      const includeCustomItemTaxes = asOptionalBoolean(req.query.includeCustomItemTaxes) === true ? true : undefined;

      const data = await TaxesService.getTaxesAndFees({
        propertyID: asOptionalString(req.query.propertyID),
        includeDeleted,
        includeExpired,
        includeCustomItemTaxes,
      });

      res.json(data);
    } catch (error) {
      if (error instanceof TaxesService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      sendErrorResponse(res, error, "Error al obtener los impuestos y cargos");
    }
  };
}
