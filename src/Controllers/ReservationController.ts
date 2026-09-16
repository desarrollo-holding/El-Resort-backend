import type { Request, Response } from "express";
import { ReservationService } from "../services/reservation.service";
import { GuestsService } from "../services/guests.service";
import { ReservationsBookService } from "../services/reservationsBook.service";
import { ItemsService } from "../services/items.service";
import { asOptionalBoolean, asOptionalInt, asOptionalString, clamp, formatCloudbedsError } from "../utils/http";

import { sendErrorResponse } from "../utils/errors";
/**
 * @openapi
 * /api/reservations:
 *   get:
 *     tags: [Reservations]
 *     summary: Listar reservas (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyID
 *         required: false
 *         schema: { type: string }
 *         description: IDs de propiedades (coma-separado)
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [not_confirmed, confirmed, canceled, checked_in, checked_out, no_show]
 *       - in: query
 *         name: resultsFrom
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: resultsTo
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: modifiedFrom
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: modifiedTo
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: checkInFrom
 *         required: false
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: checkInTo
 *         required: false
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: checkOutFrom
 *         required: false
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: checkOutTo
 *         required: false
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: datesQueryMode
 *         required: false
 *         schema:
 *           type: string
 *           enum: [booking, rooms]
 *       - in: query
 *         name: roomID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: roomName
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: roomTypeID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: includeGuestsDetails
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: includeGuestRequirements
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: includeCustomFields
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: includeAllRooms
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: sourceId
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: sourceReservationId
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: ratePlanId
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: firstName
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: lastName
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: guestID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: allotmentBlockCode
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: groupCode
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: sortByRecent
 *         required: false
 *         schema: { type: boolean, default: true }
 *       - in: query
 *         name: pageNumber
 *         required: false
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
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
 *   post:
 *     tags: [Reservations]
 *     summary: Crear reserva (Cloudbeds)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Body raw que se envía a Cloudbeds postReservation
 *             example:
 *               propertyID: null
 *               sourceID: null
 *               thirdPartyIdentifier: null
 *               startDate: "2026-03-11"
 *               endDate: "2026-03-12"
 *               guestFirstName: "Juan"
 *               guestLastName: "Perez"
 *               guestGender: "N/A"
 *               guestCountry: "PE"
 *               guestZip: "15001"
 *               guestEmail: "juan.perez@example.com"
 *               guestPhone: null
 *               guestRequirements: null
 *               estimatedArrivalTime: null
 *               rooms:
 *                 - roomTypeID: "ROOM_TYPE_ID_AQUI"
 *                   quantity: 1
 *               adults:
 *                 - roomTypeID: "ROOM_TYPE_ID_AQUI"
 *                   quantity: 2
 *               children:
 *                 - roomTypeID: "ROOM_TYPE_ID_AQUI"
 *                   quantity: 0
 *               paymentMethod: "cash"
 *               cardToken: null
 *               paymentAuthorizationCode: null
 *               customFields: null
 *               promoCode: null
 *               allotmentBlockCode: null
 *               groupCode: null
 *               dateCreated: null
 *               sendEmailConfirmation: true
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

/**
 * @openapi
 * /api/reservations/sources:
 *   get:
 *     tags: [Reservations]
 *     summary: Listar sources disponibles (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyIDs
 *         required: false
 *         schema: { type: string }
 *         description: IDs de propiedades (coma-separado)
 *     responses:
 *       200:
 *         description: Respuesta Cloudbeds (raw JSON)
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */

/**
 * @openapi
 * /api/reservations/assignments:
 *   get:
 *     tags: [Reservations]
 *     summary: Listar asignaciones de reservas/rooms (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         required: false
 *         schema: { type: string, format: date }
 *         description: Si no se envía, Cloudbeds usa el día actual
 *     responses:
 *       200:
 *         description: Respuesta Cloudbeds (raw JSON)
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */

/**
 * @openapi
 * /api/reservations/with-rate-details:
 *   get:
 *     tags: [Reservations]
 *     summary: Listar reservas con rate details (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: resultsFrom
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: resultsTo
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: modifiedFrom
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: modifiedTo
 *         required: false
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: sortByRecent
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: reservationID
 *         required: false
 *         schema: { type: string }
 *         description: Reservation identifiers (coma-separado)
 *       - in: query
 *         name: reservationCheckOutFrom
 *         required: false
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: reservationCheckOutTo
 *         required: false
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: includeDeleted
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: excludeStatuses
 *         required: false
 *         schema: { type: string }
 *         description: Lista de statuses a excluir (coma-separado)
 *       - in: query
 *         name: includeGuestsDetails
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: includeGuestRequirements
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: includeCustomFields
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: guestID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: pageNumber
 *         required: false
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema: { type: integer, default: 100, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Respuesta Cloudbeds (raw JSON)
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */

/**
 * @openapi
 * /api/reservations/{reservationID}/notes:
 *   get:
 *     tags: [Reservations]
 *     summary: Obtener notas de una reserva (Cloudbeds)
 *     parameters:
 *       - in: path
 *         name: reservationID
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: propertyID
 *         required: false
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
 *   post:
 *     tags: [Reservations]
 *     summary: Agregar nota a una reserva (Cloudbeds)
 *     parameters:
 *       - in: path
 *         name: reservationID
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: propertyID
 *         required: false
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reservationNote]
 *             properties:
 *               reservationNote: { type: string }
 *               userID: { type: string, nullable: true }
 *               dateCreated: { type: string, format: date-time, nullable: true }
 *           example:
 *             reservationNote: "Nota de prueba"
 *             userID: null
 *             dateCreated: null
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

/**
 * @openapi
 * /api/reservations/{reservationID}:
 *   get:
 *     tags: [Reservations]
 *     summary: Obtener una reserva (Cloudbeds)
 *     parameters:
 *       - in: path
 *         name: reservationID
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: propertyID
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: includeGuestRequirements
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

/**
 * @openapi
 * /api/reservations/book:
 *   post:
 *     tags: [Reservations]
 *     summary: Post reserva (modelo propio)
 *     description: Endpoint propio (combinaciÃ³n de 2 endpoints). Por ahora solo define el contrato del body.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             example:
 *               propertyID: "string"
 *               sourceID: "string"
 *               thirdPartyIdentifier: "string"
 *               startDate: "YYYY-MM-DD"
 *               endDate: "YYYY-MM-DD"
 *               guestFirstName: "string"
 *               guestLastName: "string"
   *               guestGender: "M | F | N/A"
   *               guestCountry: "PE"
   *               guestZip: "string"
   *               guestEmail: "correo@ejemplo.com"
   *               guestPhoneCountryCode: "+51"
   *               guestPhone: "999999999"
   *               estimatedArrivalTime: "14:00"
   *               mascota: 0
   *               rooms:
   *                 - roomTypeID: "string"
 *                   quantity: 1
 *                   roomID: "string"
 *                   roomRateID: "string"
 *               adults:
 *                 - roomTypeID: "string"
 *                   quantity: 2
 *                   roomID: "string"
 *               children:
 *                 - roomTypeID: "string"
 *                   quantity: 0
 *                   roomID: "string"
 *               extraGuests:
 *                 - guestFirstName: "string"
 *                   guestLastName: "string"
   *                   guestGender: "M | F | N/A"
   *                   guestCountry: "PE"
   *                   guestEmail: "correo@ejemplo.com"
   *                   guestPhoneCountryCode: "+51"
   *                   guestPhone: "999999999"
   *               paymentMethod: "cash"
   *               cardToken: "string"
   *               paymentAuthorizationCode: "string"
   *               customFields:
 *                 - fieldName: "DNI"
 *                   fieldValue: "12345678"
 *                 - fieldName: "Ciudaddeprocedencia"
 *                   fieldValue: "Lima"
 *               promoCode: "string"
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Body invÃ¡lido
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */

/**
 * @openapiDisabled
 * /api/reservations/{reservationID}/guests:
 *   post:
 *     tags: [Reservations]
 *     summary: Agregar huÃ©sped a reserva (Cloudbeds postGuest)
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
 *         description: ParÃ¡metros invÃ¡lidos
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       502:
 *         description: Error Cloudbeds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class ReservationController {
  static getSources = async (req: Request, res: Response): Promise<void> => {
    try {
      const propertyIDs = asOptionalString(req.query.propertyIDs);
      const data = await ReservationService.getSources({ propertyIDs });
      res.json(data);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al obtener los orígenes de reserva");
    }
  };

  static getReservationAssignments = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await ReservationService.getReservationAssignments({
        propertyID: asOptionalString(req.query.propertyID),
        date: asOptionalString(req.query.date),
      });
      res.json(data);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al obtener las asignaciones de la reserva");
    }
  };

  static getReservationsWithRateDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const pageNumberRaw = asOptionalInt(req.query.pageNumber);
      const pageSizeRaw = asOptionalInt(req.query.pageSize);

      if (pageNumberRaw !== undefined && pageNumberRaw < 1) {
        res.status(400).json({ error: "pageNumber inválido" });
        return;
      }
      if (pageSizeRaw !== undefined && pageSizeRaw < 1) {
        res.status(400).json({ error: "pageSize inválido" });
        return;
      }

      const pageNumber = pageNumberRaw ?? 1;
      const pageSize = clamp(pageSizeRaw ?? 100, 1, 100);

      const includeGuestsDetailsRaw = asOptionalBoolean(req.query.includeGuestsDetails);
      const includeGuestRequirementsRaw = asOptionalBoolean(req.query.includeGuestRequirements);
      const includeCustomFieldsRaw = asOptionalBoolean(req.query.includeCustomFields);
      const includeDeletedRaw = asOptionalBoolean(req.query.includeDeleted);
      const sortByRecentRaw = asOptionalBoolean(req.query.sortByRecent);

      const includeGuestRequirements = includeGuestRequirementsRaw === true ? true : undefined;
      const includeGuestsDetails =
        includeGuestRequirements === true ? true : includeGuestsDetailsRaw === true ? true : undefined;
      const includeCustomFields = includeCustomFieldsRaw === true ? true : undefined;
      const includeDeleted = includeDeletedRaw === true ? true : undefined;
      const sortByRecent = sortByRecentRaw === true ? true : undefined;

      const data = await ReservationService.getReservationsWithRateDetails({
        propertyID: asOptionalString(req.query.propertyID),
        resultsFrom: asOptionalString(req.query.resultsFrom),
        resultsTo: asOptionalString(req.query.resultsTo),
        modifiedFrom: asOptionalString(req.query.modifiedFrom),
        modifiedTo: asOptionalString(req.query.modifiedTo),
        sortByRecent,
        reservationID: asOptionalString(req.query.reservationID),
        reservationCheckOutFrom: asOptionalString(req.query.reservationCheckOutFrom),
        reservationCheckOutTo: asOptionalString(req.query.reservationCheckOutTo),
        includeDeleted,
        excludeStatuses: asOptionalString(req.query.excludeStatuses),
        includeGuestsDetails,
        includeGuestRequirements,
        includeCustomFields,
        guestID: asOptionalString(req.query.guestID),
        pageNumber,
        pageSize,
      });

      res.json(data);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al obtener las reservas con detalle de tarifa");
    }
  };

  static bookReservation = async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await ReservationsBookService.book(_req.body);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      if (error instanceof GuestsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      if (error instanceof ItemsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      if (message.includes("requerido") || message.includes("inválido") || message.includes("incluir")) {
        res.status(400).json({ error: message });
        return;
      }
      sendErrorResponse(res, error, "Error al crear la reserva");
    }
  };

  static postGuest = async (req: Request, res: Response): Promise<void> => {
    try {
      const reservationID = asOptionalString(req.params.reservationID);
      if (!reservationID) {
        res.status(400).json({ error: "reservationID es requerido" });
        return;
      }

      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ error: "Body invÃ¡lido (se espera JSON objeto)" });
        return;
      }

      const data = await GuestsService.postGuest({
        ...(req.body as Record<string, unknown>),
        reservationID,
      });
      res.json(data);
    } catch (error) {
      if (error instanceof GuestsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al registrar al huésped de la reserva");
    }
  };

  static postReservation = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        res.status(400).json({ error: "Body inválido (se espera JSON objeto)" });
        return;
      }

      const data = await ReservationService.postReservation(req.body);
      res.json(data);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al crear la reserva");
    }
  };

  static getReservationNotes = async (req: Request, res: Response): Promise<void> => {
    try {
      const reservationID = asOptionalString(req.params.reservationID);
      if (!reservationID) {
        res.status(400).json({ error: "reservationID es requerido" });
        return;
      }

      const data = await ReservationService.getReservationNotes({
        reservationID,
        propertyID: asOptionalString(req.query.propertyID),
      });
      res.json(data);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al obtener las notas de la reserva");
    }
  };

  static postReservationNote = async (req: Request, res: Response): Promise<void> => {
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

      const reservationNote =
        typeof (req.body as any).reservationNote === "string" ? (req.body as any).reservationNote.trim() : "";
      if (!reservationNote) {
        res.status(400).json({ error: "reservationNote es requerido" });
        return;
      }

      const userID = typeof (req.body as any).userID === "string" ? (req.body as any).userID.trim() : undefined;
      const dateCreated =
        typeof (req.body as any).dateCreated === "string" ? (req.body as any).dateCreated.trim() : undefined;

      const data = await ReservationService.postReservationNote({
        reservationID,
        reservationNote,
        propertyID: asOptionalString(req.query.propertyID),
        userID,
        dateCreated,
      });

      res.json(data);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      sendErrorResponse(res, error, "Error al añadir la nota a la reserva");
    }
  };

  static getReservation = async (req: Request, res: Response): Promise<void> => {
    try {
      const reservationID = asOptionalString(req.params.reservationID);
      if (!reservationID) {
        res.status(400).json({ error: "reservationID es requerido" });
        return;
      }

      const propertyID = asOptionalString(req.query.propertyID);
      const includeGuestRequirementsRaw = asOptionalBoolean(req.query.includeGuestRequirements);
      const includeGuestRequirements = includeGuestRequirementsRaw === true ? true : undefined;

      const data = await ReservationService.getReservation({ reservationID, propertyID, includeGuestRequirements });
      res.json(data);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al obtener la reserva");
    }
  };

  static getReservations = async (req: Request, res: Response): Promise<void> => {
    try {
      const pageNumberRaw = asOptionalInt(req.query.pageNumber);
      const pageSizeRaw = asOptionalInt(req.query.pageSize);

      if (pageNumberRaw !== undefined && pageNumberRaw < 1) {
        res.status(400).json({ error: "pageNumber inválido" });
        return;
      }
      if (pageSizeRaw !== undefined && pageSizeRaw < 1) {
        res.status(400).json({ error: "pageSize inválido" });
        return;
      }

      const pageNumber = pageNumberRaw ?? 1;
      const pageSize = clamp(pageSizeRaw ?? 20, 1, 20);

      type ReservationQueryParams = NonNullable<Parameters<typeof ReservationService.getReservations>[0]>;

      const status = asOptionalString(req.query.status);
      const allowedStatus: NonNullable<ReservationQueryParams["status"]>[] = [
        "not_confirmed",
        "confirmed",
        "canceled",
        "checked_in",
        "checked_out",
        "no_show",
      ];
      if (status && !allowedStatus.includes(status as any)) {
        res.status(400).json({ error: "status inválido" });
        return;
      }

      const datesQueryMode = asOptionalString(req.query.datesQueryMode);
      const allowedDatesQueryMode: NonNullable<ReservationQueryParams["datesQueryMode"]>[] = [
        "booking",
        "rooms",
      ];
      if (datesQueryMode && !allowedDatesQueryMode.includes(datesQueryMode as any)) {
        res.status(400).json({ error: "datesQueryMode inválido" });
        return;
      }

      const includeGuestsDetailsRaw = asOptionalBoolean(req.query.includeGuestsDetails);
      const includeGuestRequirementsRaw = asOptionalBoolean(req.query.includeGuestRequirements);
      const includeCustomFieldsRaw = asOptionalBoolean(req.query.includeCustomFields);
      const includeAllRoomsRaw = asOptionalBoolean(req.query.includeAllRooms);

      if (includeGuestRequirementsRaw === true && includeGuestsDetailsRaw !== true) {
        res.status(400).json({ error: "includeGuestRequirements requiere includeGuestsDetails=true" });
        return;
      }

      const includeGuestRequirements = includeGuestRequirementsRaw === true ? true : undefined;
      const includeGuestsDetails = includeGuestsDetailsRaw === true ? true : undefined;
      const includeCustomFields = includeCustomFieldsRaw === true ? true : undefined;
      const includeAllRooms = includeAllRoomsRaw === true ? true : undefined;

      const sortByRecentRaw = asOptionalBoolean(req.query.sortByRecent);
      const sortByRecent = sortByRecentRaw === false ? false : undefined;

      const data = await ReservationService.getReservations({
        pageNumber,
        pageSize,
        propertyID: asOptionalString(req.query.propertyID),
        status: status as any,
        resultsFrom: asOptionalString(req.query.resultsFrom),
        resultsTo: asOptionalString(req.query.resultsTo),
        modifiedFrom: asOptionalString(req.query.modifiedFrom),
        modifiedTo: asOptionalString(req.query.modifiedTo),
        checkInFrom: asOptionalString(req.query.checkInFrom),
        checkInTo: asOptionalString(req.query.checkInTo),
        checkOutFrom: asOptionalString(req.query.checkOutFrom),
        checkOutTo: asOptionalString(req.query.checkOutTo),
        datesQueryMode: datesQueryMode as any,
        roomID: asOptionalString(req.query.roomID),
        roomName: asOptionalString(req.query.roomName),
        roomTypeID: asOptionalString(req.query.roomTypeID),
        includeGuestsDetails,
        includeGuestRequirements,
        includeCustomFields,
        includeAllRooms,
        sourceId: asOptionalString(req.query.sourceId),
        sourceReservationId: asOptionalString(req.query.sourceReservationId),
        ratePlanId: asOptionalString(req.query.ratePlanId),
        firstName: asOptionalString(req.query.firstName),
        lastName: asOptionalString(req.query.lastName),
        guestID: asOptionalString(req.query.guestID),
        allotmentBlockCode: asOptionalString(req.query.allotmentBlockCode),
        groupCode: asOptionalString(req.query.groupCode),
        sortByRecent,
      });
      res.json(data);
    } catch (error) {
      if (error instanceof ReservationService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }
      sendErrorResponse(res, error, "Error al obtener las reservas");
    }
  };
}
