import type { Request, Response } from "express";
import { GuestsService } from "../services/guests.service";
import { asOptionalString, formatCloudbedsError } from "../utils/http";

import { sendErrorResponse } from "../utils/errors";
/**
 * @openapi
 * /api/reservations/{reservationID}/guests:
 *   post:
 *     tags: [Guests]
 *     summary: Agregar huésped a reserva (Cloudbeds postGuest)
 *     parameters:
 *       - in: path
 *         name: reservationID
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Body que se transforma a x-www-form-urlencoded para Cloudbeds postGuest
 *             example:
 *               propertyID: null
 *               guestFirstName: "Juan"
 *               guestLastName: "Perez"
 *               guestGender: "N/A"
 *               guestEmail: "juan.perez@example.com"
 *               guestPhone: null
 *               guestCellPhone: null
 *               guestAddress1: null
 *               guestAddress2: null
 *               guestCity: null
 *               guestCountry: "PE"
 *               guestState: null
 *               guestZip: null
 *               guestBirthDate: null
 *               guestDocumentType: null
 *               guestDocumentNumber: null
 *               guestDocumentIssueDate: null
 *               guestDocumentIssuingCountry: null
 *               guestDocumentExpirationDate: null
 *               guestRequirements: null
 *               customFields: null
 *               guestNote: null
 *               reservationNote: null
 *               guestCompanyName: null
 *               guestCompanyTaxId: null
 *               guestTaxId: null
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
export class GuestsController {
  static postGuest = async (req: Request, res: Response): Promise<void> => {
    try {
      const reservationID = asOptionalString(req.params.reservationID);
      if (!reservationID) {
        res.status(400).json({ error: "reservationID es requerido" });
        return;
      }

      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ error: "Body inválido (se espera JSON objeto)" });
        return;
      }

      const data = await GuestsService.postGuest({
        ...(req.body as Record<string, unknown>),
        reservationID,
      } as unknown as Parameters<typeof GuestsService.postGuest>[0]);

      res.json(data);
    } catch (error) {
      if (error instanceof GuestsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al registrar al huésped");
    }
  };
}

