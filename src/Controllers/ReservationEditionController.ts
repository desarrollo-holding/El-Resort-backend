import type { Request, Response } from "express";
import { ReservationService } from "../services/reservation.service";
import { ReservationEditionService } from "../services/reservationEdition.service";
import { asOptionalString, formatCloudbedsError } from "../utils/http";
import { sendErrorResponse } from "../utils/errors";

/**
 * @openapi
 * /api/reservations/{reservationID}/confirm:
 *   put:
 *     tags: [ReservationEdition]
 *     summary: Confirmar reserva (modelo propio)
 *     description: Confirma una reserva en Cloudbeds usando putReservation (solo cambia status a confirmed).
 *     parameters:
 *       - in: path
 *         name: reservationID
 *         required: true
 *         schema: { type: string }
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
export class ReservationEditionController {
  static confirmReservation = async (req: Request, res: Response): Promise<void> => {
    try {
      const reservationID = asOptionalString(req.params.reservationID);
      if (!reservationID) {
        res.status(400).json({ error: "reservationID es requerido" });
        return;
      }

      const data = await ReservationEditionService.confirmReservation(reservationID);
      res.json({ success: true, data });
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      const message = error instanceof Error ? error.message : "Error interno del servidor";
      if (message.includes("requerido") || message.includes("inválido")) {
        res.status(400).json({ error: message });
        return;
      }
      sendErrorResponse(res, error, "Error al confirmar la reserva");
    }
  };
}

