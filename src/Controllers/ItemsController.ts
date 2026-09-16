import type { Request, Response } from "express";
import { ItemsService } from "../services/items.service";
import { asOptionalString, formatCloudbedsError } from "../utils/http";

import { sendErrorResponse } from "../utils/errors";
/**
 * @openapi
 * /api/items:
 *   get:
 *     tags: [Items]
 *     summary: Listar items (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: itemCategoryID
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
 *   post:
 *     tags: [Items]
 *     summary: Agregar item a reserva/house account (Cloudbeds)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemID, itemQuantity]
 *             properties:
 *               propertyID: { type: string, nullable: true }
 *               reservationID: { type: string, nullable: true }
 *               houseAccountID: { type: string, nullable: true }
 *               groupCode: { type: string, nullable: true }
 *               subReservationID: { type: string, nullable: true }
 *               itemID: { type: string }
 *               itemQuantity: { type: integer }
 *               itemPrice: { type: string, nullable: true }
 *               itemNote: { type: string, nullable: true }
 *               itemPaid: { type: boolean, nullable: true, default: false }
 *               saleDate: { type: string, format: date-time, nullable: true }
 *               payments:
 *                 type: array
 *                 nullable: true
 *                 items:
 *                   type: object
 *                   required: [paymentType, amount]
 *                   properties:
 *                     paymentType: { type: string }
 *                     amount: { type: number }
 *                     notes: { type: string, nullable: true }
 *           example:
 *             propertyID: "297440"
 *             reservationID: "123456789"
 *             houseAccountID: null
 *             groupCode: null
 *             subReservationID: null
 *             itemID: "111"
 *             itemQuantity: 1
 *             itemPrice: null
 *             itemNote: "Item agregado por API"
 *             itemPaid: false
 *             saleDate: null
 *             payments:
 *               - paymentType: "cash"
 *                 amount: 25
 *                 notes: null
 *     responses:
 *       200:
 *         description: Respuesta Cloudbeds (raw JSON)
 *       400:
 *         description: Body inválido
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class ItemsController {
  static getItems = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await ItemsService.getItems({
        propertyID: asOptionalString(req.query.propertyID),
        itemCategoryID: asOptionalString(req.query.itemCategoryID),
      });

      res.json(data);
    } catch (error) {
      if (error instanceof ItemsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      sendErrorResponse(res, error, "Error al obtener los ítems");
    }
  };

  static postItem = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ error: "Body inválido (se espera JSON objeto)" });
        return;
      }

      const body = req.body as any;
      const itemID = typeof body.itemID === "string" ? body.itemID.trim() : "";
      const itemQuantity = Number(body.itemQuantity);

      if (!itemID) {
        res.status(400).json({ error: "itemID es requerido" });
        return;
      }
      if (!Number.isInteger(itemQuantity) || itemQuantity <= 0) {
        res.status(400).json({ error: "itemQuantity inválido" });
        return;
      }

      const reservationID = typeof body.reservationID === "string" ? body.reservationID.trim() : "";
      const houseAccountID = typeof body.houseAccountID === "string" ? body.houseAccountID.trim() : "";
      const groupCode = typeof body.groupCode === "string" ? body.groupCode.trim() : "";

      if (!reservationID && !houseAccountID && !groupCode) {
        res.status(400).json({ error: "reservationID, houseAccountID o groupCode es requerido" });
        return;
      }

      const data = await ItemsService.postItem(body);
      res.json(data);
    } catch (error) {
      if (error instanceof ItemsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      sendErrorResponse(res, error, "Error al crear el ítem");
    }
  };
}
