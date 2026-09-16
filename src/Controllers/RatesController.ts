import type { Request, Response } from "express";
import { RatesService } from "../services/rates.service";
import { asOptionalBoolean, asOptionalInt, asOptionalString, formatCloudbedsError } from "../utils/http";

import { sendErrorResponse } from "../utils/errors";
const asRequiredString = (value: unknown): string | undefined => asOptionalString(value);

/**
 * @openapi
 * /api/rates:
 *   get:
 *     tags: [Rates]
 *     summary: Obtener rate (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: roomTypeID
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: adults
 *         required: false
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: children
 *         required: false
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: detailedRates
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: promoCode
 *         required: false
 *         schema: { type: boolean, default: false }
 *         description: DEPRECATED en Cloudbeds (recomiendan getRatePlans)
 *     responses:
 *       200:
 *         description: Respuesta Cloudbeds (raw JSON)
 *       400:
 *         description: Parámetros inválidos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class RatesController {
  static getRate = async (req: Request, res: Response): Promise<void> => {
    try {
      const roomTypeID = asRequiredString(req.query.roomTypeID);
      const startDate = asRequiredString(req.query.startDate);
      const endDate = asRequiredString(req.query.endDate);

      if (!roomTypeID) {
        res.status(400).json({ error: "roomTypeID es requerido" });
        return;
      }
      if (!startDate) {
        res.status(400).json({ error: "startDate es requerido" });
        return;
      }
      if (!endDate) {
        res.status(400).json({ error: "endDate es requerido" });
        return;
      }

      const adults = asOptionalInt(req.query.adults);
      const children = asOptionalInt(req.query.children);
      if (adults !== undefined && adults < 0) {
        res.status(400).json({ error: "adults inválido" });
        return;
      }
      if (children !== undefined && children < 0) {
        res.status(400).json({ error: "children inválido" });
        return;
      }

      const detailedRates = asOptionalBoolean(req.query.detailedRates);
      const promoCode = asOptionalBoolean(req.query.promoCode);

      const data = await RatesService.getRate({
        roomTypeID,
        startDate,
        endDate,
        adults,
        children,
        detailedRates: detailedRates === true ? true : undefined,
        promoCode: promoCode === true ? true : undefined,
      });

      res.json(data);
    } catch (error) {
      if (error instanceof RatesService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      sendErrorResponse(res, error, "Error al obtener la tarifa");
    }
  };

  /**
   * @openapi
   * /api/rates/plans:
   *   get:
   *     tags: [Rates]
   *     summary: Obtener rate plans (Cloudbeds)
   *     parameters:
   *       - in: query
   *         name: propertyIDs
   *         required: false
   *         schema: { type: string }
   *         description: IDs de propiedades (coma-separado)
   *       - in: query
   *         name: rateIDs
   *         required: false
   *         schema: { type: string }
   *         description: IDs de rates (coma-separado)
   *       - in: query
   *         name: roomTypeID
   *         required: false
   *         schema: { type: string }
   *         description: Room Type IDs (coma-separado)
   *       - in: query
   *         name: promoCode
   *         required: false
   *         schema: { type: string }
   *         description: Promo codes (coma-separado)
   *       - in: query
   *         name: includePromoCode
   *         required: false
   *         schema: { type: boolean, default: true }
   *       - in: query
   *         name: startDate
   *         required: false
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: endDate
   *         required: false
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: adults
   *         required: false
   *         schema: { type: integer, minimum: 0 }
   *       - in: query
   *         name: children
   *         required: false
   *         schema: { type: integer, minimum: 0 }
   *       - in: query
   *         name: detailedRates
   *         required: false
   *         schema: { type: boolean, default: false }
   *       - in: query
   *         name: includeSharedRooms
   *         required: false
   *         schema: { type: boolean, default: false }
   *     responses:
   *       200:
   *         description: Respuesta Cloudbeds (raw JSON)
   *       400:
   *         description: Parámetros inválidos
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   *       502:
   *         description: Error Cloudbeds
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   */
  static getRatePlans = async (req: Request, res: Response): Promise<void> => {
    try {
      const adults = asOptionalInt(req.query.adults);
      const children = asOptionalInt(req.query.children);
      if (adults !== undefined && adults < 0) {
        res.status(400).json({ error: "adults inválido" });
        return;
      }
      if (children !== undefined && children < 0) {
        res.status(400).json({ error: "children inválido" });
        return;
      }

      const detailedRates = asOptionalBoolean(req.query.detailedRates);
      const includeSharedRooms = asOptionalBoolean(req.query.includeSharedRooms);
      const includePromoCode = asOptionalBoolean(req.query.includePromoCode);

      const data = await RatesService.getRatePlans({
        propertyIDs: asOptionalString(req.query.propertyIDs),
        rateIDs: asOptionalString(req.query.rateIDs),
        roomTypeID: asOptionalString(req.query.roomTypeID),
        promoCode: asOptionalString(req.query.promoCode),
        startDate: asOptionalString(req.query.startDate),
        endDate: asOptionalString(req.query.endDate),
        adults,
        children,
        detailedRates: detailedRates === true ? true : undefined,
        includeSharedRooms: includeSharedRooms === true ? true : undefined,
        includePromoCode: includePromoCode === false ? false : undefined,
      });

      res.json(data);
    } catch (error) {
      if (error instanceof RatesService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      sendErrorResponse(res, error, "Error al obtener los planes de tarifa");
    }
  };
}
