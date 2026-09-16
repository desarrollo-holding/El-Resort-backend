import type { Request, Response } from "express";
import { IzipayPaymentsService } from "../services/izipayPayments.service";
import { ReservationService } from "../services/reservation.service";
import { ReservationEditionService } from "../services/reservationEdition.service";
import ReservationPaymentConfirmation from "../models/ReservationPaymentConfirmation";
import { getIzipayResortConfigFromEnv } from "../config/izipay";
import { checkIzipayHash, parseIzipayAnswerJson } from "../utils/izipaySignature";
import { formatCloudbedsError } from "../utils/http";

import { sendErrorResponse } from "../utils/errors";
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const asNonEmptyTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

const extractServiceIdFromIzipayAnswer = (answer: Record<string, unknown>): string | undefined => {
  const orderDetails = asRecord(answer["orderDetails"]);
  const orderId = asNonEmptyTrimmedString(orderDetails?.["orderId"]);
  if (orderId) return orderId;

  const rootOp = asNonEmptyTrimmedString(answer["operationId"] ?? answer["operationID"]);
  if (rootOp) return rootOp;

  const txs = Array.isArray(answer["transactions"]) ? (answer["transactions"] as unknown[]) : [];
  const firstTx = asRecord(txs[0]);

  const txOp = asNonEmptyTrimmedString(firstTx?.["operationId"] ?? firstTx?.["operationID"]);
  if (txOp) return txOp;

  const uuid = asNonEmptyTrimmedString(firstTx?.["uuid"]);
  if (uuid) return uuid;

  return undefined;
};

const extractTransactionUuidFromIzipayAnswer = (answer: Record<string, unknown>): string | undefined => {
  const txs = Array.isArray(answer["transactions"]) ? (answer["transactions"] as unknown[]) : [];
  const firstTx = asRecord(txs[0]);
  return asNonEmptyTrimmedString(firstTx?.["uuid"]);
};

/**
 * @openapi
 * /api/izipay/formtoken:
 *   post:
 *     tags: [Izipay]
 *     summary: Generar formToken (CreatePayment)
 *     description: Crea un pago en Izipay (Lyra) y retorna el `formToken` para el formulario embebido.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IzipayFormTokenRequest' }
 *     responses:
 *       200:
 *         description: formToken generado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/IzipayFormTokenResponse' }
 *       400:
 *         description: Parámetros inválidos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       502:
 *         description: Error Izipay
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Error interno
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class IzipayController {
  static formtoken = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        amount,
        currency,
        orderId,
        email,
        customerEmail,
        firstName,
        lastName,
        customerName,
        phoneNumber,
        identityType,
        identityCode,
        address,
        country,
        city,
        state,
        zipCode,
      } = (req.body || {}) as Record<string, unknown>;

      if (typeof amount !== "number") {
        res.status(400).json({ error: "amount es requerido (number)" });
        return;
      }
      if (typeof orderId !== "string" || !orderId.trim()) {
        res.status(400).json({ error: "orderId es requerido (string)" });
        return;
      }

      const result = await IzipayPaymentsService.createResortFormToken({
        amount,
        currency: typeof currency === "string" ? currency : undefined,
        orderId,
        email: typeof email === "string" ? email : undefined,
        customerEmail: typeof customerEmail === "string" ? customerEmail : undefined,
        customerName: typeof customerName === "string" ? customerName : undefined,
        firstName: typeof firstName === "string" ? firstName : undefined,
        lastName: typeof lastName === "string" ? lastName : undefined,
        phoneNumber: typeof phoneNumber === "string" ? phoneNumber : undefined,
        identityType: typeof identityType === "string" ? identityType : undefined,
        identityCode: typeof identityCode === "string" ? identityCode : undefined,
        address: typeof address === "string" ? address : undefined,
        country: typeof country === "string" ? country : undefined,
        city: typeof city === "string" ? city : undefined,
        state: typeof state === "string" ? state : undefined,
        zipCode: typeof zipCode === "string" ? zipCode : undefined,
      });

      res.json({ formToken: result.formToken, publicKey: result.publicKey });
    } catch (error) {
      if (error instanceof IzipayPaymentsService.IzipayHttpError) {
        res.status(error.status || 502).json({ error: "Error al conectar con Izipay" });
        return;
      }
      sendErrorResponse(res, error, "Error al preparar el formulario de pago");
    }
  };

  /**
   * @openapi
   * /api/izipay/formtoken/from-payment-token:
   *   post:
   *     tags: [Izipay]
   *     summary: Generar formToken desde reservationID (paymentToken)
   *     description: Valida el paymentToken (Bearer) y usa Cloudbeds getReservation para mapear datos a Izipay.
   *     security: [{ paymentTokenAuth: [] }]
   *     responses:
   *       200:
   *         description: formToken generado
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/IzipayFormTokenResponse' }
   *       401:
   *         description: No autorizado
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   *       502:
   *         description: Error Cloudbeds/Izipay
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   *       500:
   *         description: Error interno
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   */
  static formtokenFromPaymentToken = async (req: Request, res: Response): Promise<void> => {
    try {
      const reservationID = req.payment?.reservationID;
      if (!reservationID) {
        res.status(401).json({ error: "No autorizado" });
        return;
      }

      const reservation = await ReservationService.getReservation({ reservationID });

      const data = reservation && typeof reservation === "object" && !Array.isArray(reservation) ? (reservation as any).data : undefined;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        res.status(502).json({ error: "Respuesta inválida de Cloudbeds" });
        return;
      }

      const total = (data as any).total;
      const orderId = (data as any).reservationID;
      const guestEmail = (data as any).guestEmail;
      const guestName = (data as any).guestName;

      const guestListRaw = (data as any).guestList;
      const guestList =
        guestListRaw && typeof guestListRaw === "object" && !Array.isArray(guestListRaw) ? (guestListRaw as Record<string, any>) : {};
      const guestEntries = Object.values(guestList).filter((v) => v && typeof v === "object" && !Array.isArray(v)) as any[];
      const mainGuest = guestEntries.find((g) => g.isMainGuest === true) ?? guestEntries[0] ?? {};

      const firstName = typeof mainGuest.guestFirstName === "string" ? mainGuest.guestFirstName : undefined;
      const lastName = typeof mainGuest.guestLastName === "string" ? mainGuest.guestLastName : undefined;
      const phoneNumber = typeof mainGuest.guestPhone === "string" ? mainGuest.guestPhone : undefined;
      const identityType = typeof mainGuest.guestDocumentType === "string" ? mainGuest.guestDocumentType : undefined;
      const identityCode = typeof mainGuest.guestDocumentNumber === "string" ? mainGuest.guestDocumentNumber : undefined;
      const country = typeof mainGuest.guestCountry === "string" ? mainGuest.guestCountry : undefined;
      const city = typeof mainGuest.guestCity === "string" ? mainGuest.guestCity : undefined;
      const address = "Av. Javier Prado 123";
      const state = "Lima";
      const zipCode = "15046";

      if (typeof total !== "number" || !Number.isFinite(total)) {
        res.status(502).json({ error: "Cloudbeds no devolvió total válido" });
        return;
      }
      if (typeof orderId !== "string" || !orderId.trim()) {
        res.status(502).json({ error: "Cloudbeds no devolvió reservationID válido" });
        return;
      }
      if (typeof guestEmail !== "string" || !guestEmail.trim()) {
        res.status(502).json({ error: "Cloudbeds no devolvió guestEmail válido" });
        return;
      }

      const result = await IzipayPaymentsService.createResortFormToken({
        amount: total,
        currency: "PEN",
        orderId,
        email: guestEmail,
        customerEmail: guestEmail,
        customerName: typeof guestName === "string" ? guestName : undefined,
        firstName,
        lastName,
        phoneNumber,
        identityType,
        identityCode,
        address,
        country,
        city,
        state,
        zipCode,
      });

      res.json({ formToken: result.formToken, publicKey: result.publicKey });
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: "Error al conectar con Cloudbeds" });
        return;
      }
      if (error instanceof IzipayPaymentsService.IzipayHttpError) {
        res.status(error.status || 502).json({ error: "Error al conectar con Izipay" });
        return;
      }
      sendErrorResponse(res, error, "Error al preparar el formulario de pago");
    }
  };

  /**
   * @openapi
   * /api/izipay/validate:
   *   post:
   *     tags: [Izipay]
   *     summary: Validar firma (front kr-answer)
   *     description: Valida `kr-answer` usando la clave HMAC-SHA256 (solo backend). Si es vÃ¡lido, confirma la reserva/servicio en Cloudbeds.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/IzipaySignatureRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/IzipaySignatureRequest' }
   *     responses:
   *       200:
   *         description: true/false
   *         content:
   *           application/json:
   *             schema: { type: boolean }
   *       400:
   *         description: Body inválido
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   */
  static validateSignature = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length === 0) {
        res.status(400).json({ error: "No post data received!" });
        return;
      }

      const config = getIzipayResortConfigFromEnv();
      const valid = checkIzipayHash(req.body as Record<string, unknown>, config.hmacSha256);
      if (!valid) {
        res.status(200).send(false);
        return;
      }

      const answer = parseIzipayAnswerJson(req.body as Record<string, unknown>);
      const serviceID = extractServiceIdFromIzipayAnswer(answer);
      if (!serviceID) {
        res.status(400).json({ error: "No se pudo obtener serviceID desde kr-answer (operationId/orderId)" });
        return;
      }

      await ReservationEditionService.confirmReservation(serviceID);

      const transactionUuid = extractTransactionUuidFromIzipayAnswer(answer);
      if (transactionUuid) {
        const results = await Promise.allSettled([
          ReservationPaymentConfirmation.findOneAndUpdate(
            { reservationID: serviceID.trim() },
            { reservationID: serviceID.trim(), uuid: transactionUuid },
            { upsert: true, new: true }
          ).exec(),
          ReservationService.postReservationNote({
            propertyID: "297440",
            reservationID: serviceID.trim(),
            reservationNote: transactionUuid,
          }),
        ]);

        for (const result of results) {
          if (result.status === "rejected") {
            console.warn("Izipay validate: post-confirm side effect failed:", result.reason);
          }
        }
      } else {
        console.warn("Izipay validate: no se encontrÃ³ transactions[0].uuid; se omite persistencia y note.");
      }

      res.status(200).send(true);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      res.status(400).json({ error: message });
    }
  };

  /**
   * @openapi
   * /api/izipay/ipn:
   *   post:
   *     tags: [Izipay]
   *     summary: IPN (webhook Izipay)
   *     description: Verifica firma con `PASSWORD` y responde OK al servidor de Izipay.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/IzipaySignatureRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/IzipaySignatureRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           text/plain:
   *             schema: { type: string }
   *       400:
   *         description: Firma inválida / Body inválido
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   */
  static ipn = (req: Request, res: Response): void => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length === 0) {
        res.status(400).json({ error: "No post data received!" });
        return;
      }

      const config = getIzipayResortConfigFromEnv();
      if (!checkIzipayHash(req.body as Record<string, unknown>, config.password)) {
        res.status(400).json({ error: "Invalid signature" });
        return;
      }

      const answer = parseIzipayAnswerJson(req.body as Record<string, unknown>);
      const orderStatus = typeof answer["orderStatus"] === "string" ? (answer["orderStatus"] as string) : "UNKNOWN";

      const orderDetails =
        answer["orderDetails"] && typeof answer["orderDetails"] === "object" && !Array.isArray(answer["orderDetails"])
          ? (answer["orderDetails"] as Record<string, unknown>)
          : undefined;
      const orderId = typeof orderDetails?.["orderId"] === "string" ? (orderDetails["orderId"] as string) : "UNKNOWN";

      const transactions = Array.isArray(answer["transactions"]) ? (answer["transactions"] as unknown[]) : [];
      const firstTx =
        transactions[0] && typeof transactions[0] === "object" && !Array.isArray(transactions[0])
          ? (transactions[0] as Record<string, unknown>)
          : undefined;
      const transactionUuid = typeof firstTx?.["uuid"] === "string" ? (firstTx["uuid"] as string) : "UNKNOWN";

      // Importante: responder 200 para que Izipay no reintente.
      res.status(200).send(`OK! OrderStatus is ${orderStatus} (orderId=${orderId}, tx=${transactionUuid})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      res.status(400).json({ error: message });
    }
  };
}
