import type { Request, Response } from "express";
import { RoomsService } from "../services/rooms.service";
import { RoomTypesShowService } from "../services/roomTypesShow.service";
import { asOptionalBoolean, asOptionalInt, asOptionalString, formatCloudbedsError } from "../utils/http";
import { getDefaultStayDates, isIsoDateYmd } from "../utils/dates";

/**
 * @openapi
 * /api/rooms:
 *   get:
 *     tags: [Rooms]
 *     summary: Listar rooms (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyIDs
 *         required: false
 *         schema: { type: string }
 *         description: Property IDs (coma-separado)
 *       - in: query
 *         name: roomTypeID
 *         required: false
 *         schema: { type: string }
 *         description: Room type IDs (coma-separado)
 *       - in: query
 *         name: roomTypeNameShort
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: includeRoomRelations
 *         required: false
 *         schema: { type: integer, default: 0, minimum: 0 }
 *       - in: query
 *         name: pageNumber
 *         required: false
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema: { type: integer, default: 20, minimum: 1 }
 *       - in: query
 *         name: sort
 *         required: false
 *         schema: { type: string }
 *         description: "Reglas: field[:direction];... (room_position, sorting_position)"
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
 * /api/rooms/types:
 *   get:
 *     tags: [Rooms]
 *     summary: Listar room types (Cloudbeds)
 *     parameters:
 *       - in: query
 *         name: propertyIDs
 *         required: false
 *         schema: { type: string }
 *         description: Property IDs (coma-separado)
 *       - in: query
 *         name: roomTypeIDs
 *         required: false
 *         schema: { type: string }
 *         description: Room Type IDs (coma-separado)
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema: { type: string, format: date }
 *         description: Check-in date (requerido si se quieren rates)
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema: { type: string, format: date }
 *         description: Check-out date (requerido si se quieren rates)
 *       - in: query
 *         name: adults
 *         required: false
 *         schema: { type: integer, minimum: 0 }
 *         description: Requerido si se quieren rates
 *       - in: query
 *         name: children
 *         required: false
 *         schema: { type: integer, minimum: 0 }
 *         description: Requerido si se quieren rates
 *       - in: query
 *         name: detailedRates
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: roomTypeName
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: propertyCity
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: propertyName
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: maxGuests
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: pageNumber
 *         required: false
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema: { type: integer, default: 20, minimum: 1 }
 *       - in: query
 *         name: sort
 *         required: false
 *         schema: { type: string }
 *         description: "Reglas: field[:direction];... (sorting_position)"
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
 * /api/rooms/show:
 *   get:
 *     tags: [Rooms]
 *     summary: Listar room types (modelo propio, base)
 *     description: Agrega /api/rooms + /api/rooms/types y devuelve RoomTypeModel[]. pricing queda vacío por defecto.
 *     parameters:
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: maxGuests
 *         required: false
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: promoCode
 *         required: false
 *         schema: { type: string }
 *         description: "Si se envía, se pasa a /api/rates/plans como filtro. Si NO se envía, se fuerza includePromoCode=false."
 *       - in: query
 *         name: pageNumber
 *         required: false
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema: { type: integer, default: 20, minimum: 1 }
 *     responses:
 *       200:
 *         description: Listado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { type: object }
 *                 count: { type: integer }
 *                 total: { type: integer }
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
export class RoomsController {
  static getRooms = async (req: Request, res: Response): Promise<void> => {
    try {
      const startDate = asOptionalString(req.query.startDate);
      const endDate = asOptionalString(req.query.endDate);

      if ((startDate && !endDate) || (!startDate && endDate)) {
        res.status(400).json({ error: "startDate y endDate deben enviarse juntos" });
        return;
      }

      const includeRoomRelations = asOptionalInt(req.query.includeRoomRelations);
      if (includeRoomRelations !== undefined && includeRoomRelations < 0) {
        res.status(400).json({ error: "includeRoomRelations inválido" });
        return;
      }

      const pageNumber = asOptionalInt(req.query.pageNumber);
      const pageSize = asOptionalInt(req.query.pageSize);
      if (pageNumber !== undefined && pageNumber < 1) {
        res.status(400).json({ error: "pageNumber inválido" });
        return;
      }
      if (pageSize !== undefined && pageSize < 1) {
        res.status(400).json({ error: "pageSize inválido" });
        return;
      }

      const data = await RoomsService.getRooms({
        propertyIDs: asOptionalString(req.query.propertyIDs),
        roomTypeID: asOptionalString(req.query.roomTypeID),
        roomTypeNameShort: asOptionalString(req.query.roomTypeNameShort),
        startDate,
        endDate,
        includeRoomRelations,
        pageNumber: pageNumber ?? 1,
        pageSize: pageSize ?? 20,
        sort: asOptionalString(req.query.sort),
      });

      res.json(data);
    } catch (error) {
      if (error instanceof RoomsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static getRoomTypes = async (req: Request, res: Response): Promise<void> => {
    try {
      const startDate = asOptionalString(req.query.startDate);
      const endDate = asOptionalString(req.query.endDate);

      if ((startDate && !endDate) || (!startDate && endDate)) {
        res.status(400).json({ error: "startDate y endDate deben enviarse juntos" });
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

      const pageNumber = asOptionalInt(req.query.pageNumber);
      const pageSize = asOptionalInt(req.query.pageSize);
      if (pageNumber !== undefined && pageNumber < 1) {
        res.status(400).json({ error: "pageNumber inválido" });
        return;
      }
      if (pageSize !== undefined && pageSize < 1) {
        res.status(400).json({ error: "pageSize inválido" });
        return;
      }

      const detailedRates = asOptionalBoolean(req.query.detailedRates);

      const data = await RoomsService.getRoomTypes({
        propertyIDs: asOptionalString(req.query.propertyIDs),
        roomTypeIDs: asOptionalString(req.query.roomTypeIDs),
        startDate,
        endDate,
        adults,
        children,
        detailedRates: detailedRates === true ? true : undefined,
        roomTypeName: asOptionalString(req.query.roomTypeName),
        propertyCity: asOptionalString(req.query.propertyCity),
        propertyName: asOptionalString(req.query.propertyName),
        maxGuests: asOptionalString(req.query.maxGuests),
        pageNumber: pageNumber ?? 1,
        pageSize: pageSize ?? 20,
        sort: asOptionalString(req.query.sort),
      });

      res.json(data);
    } catch (error) {
      if (error instanceof RoomsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static showRoomTypes = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = req.query as Record<string, unknown>;
      const startDate = asOptionalString(query.startDate ?? query["start-date"]);
      const endDate = asOptionalString(query.endDate ?? query["end-date"]);
      const promoCode = asOptionalString(query.promoCode);

      if (!startDate || !endDate) {
        res.status(400).json({ error: "startDate y endDate son requeridos" });
        return;
      }

      if (!isIsoDateYmd(startDate) || !isIsoDateYmd(endDate)) {
        res.status(400).json({ error: "startDate/endDate deben tener formato YYYY-MM-DD" });
        return;
      }

      const maxGuests = asOptionalInt(query.maxGuests);
      if (maxGuests !== undefined && maxGuests < 0) {
        res.status(400).json({ error: "maxGuests invÃ¡lido" });
        return;
      }

      const pageNumber = asOptionalInt(query.pageNumber) ?? 1;
      const pageSize = asOptionalInt(query.pageSize) ?? 20;
      if (pageNumber < 1) {
        res.status(400).json({ error: "pageNumber invÃ¡lido" });
        return;
      }
      if (pageSize < 1) {
        res.status(400).json({ error: "pageSize invÃ¡lido" });
        return;
      }

      const all = await RoomTypesShowService.listRoomTypesWithPricing({ startDate, endDate, maxGuests, promoCode });
      const total = all.length;
      const startIndex = (pageNumber - 1) * pageSize;
      const data = all.slice(startIndex, startIndex + pageSize);

      res.json({ success: true, data, count: data.length, total });
    } catch (error) {
      if (error instanceof RoomsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  /**
   * @openapi
   * /api/rooms/show-lite:
   *   get:
   *     tags: [Rooms]
   *     summary: Listar room types (modelo reducido)
   *     description: Devuelve un payload reducido con todos los room types. El pricing se obtiene desde RoomTypeLocalSpecs (BD local).
   *     parameters:
   *       - in: query
   *         name: maxGuests
   *         required: false
   *         schema: { type: integer, minimum: 0 }
   *       - in: query
   *         name: pageNumber
   *         required: false
   *         schema: { type: integer, default: 1, minimum: 1 }
   *       - in: query
   *         name: pageSize
   *         required: false
   *         schema: { type: integer, default: 20, minimum: 1 }
   *     responses:
   *       200:
   *         description: Listado
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean }
   *                 data:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/RoomTypeReduced' }
   *                 count: { type: integer }
   *                 total: { type: integer }
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
  static showRoomTypesLite = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = req.query as Record<string, unknown>;

      const maxGuests = asOptionalInt(query.maxGuests);
      if (maxGuests !== undefined && maxGuests < 0) {
        res.status(400).json({ error: "maxGuests inválido" });
        return;
      }

      const pageNumber = asOptionalInt(query.pageNumber) ?? 1;
      const pageSize = asOptionalInt(query.pageSize) ?? 20;
      if (pageNumber < 1) {
        res.status(400).json({ error: "pageNumber inválido" });
        return;
      }
      if (pageSize < 1) {
        res.status(400).json({ error: "pageSize inválido" });
        return;
      }

      const all = await RoomTypesShowService.listRoomTypesReducedCatalogWithLocalPricing({ maxGuests });
      const total = all.length;
      const startIndex = (pageNumber - 1) * pageSize;
      const data = all.slice(startIndex, startIndex + pageSize);

      res.json({ success: true, data, count: data.length, total });
    } catch (error) {
      if (error instanceof RoomsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  /**
   * @openapi
   * /api/rooms/show/{roomTypeID}:
   *   get:
   *     tags: [Rooms]
   *     summary: Obtener RoomTypeModel completo por roomTypeID
   *     parameters:
   *       - in: path
   *         name: roomTypeID
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: maxGuests
   *         required: false
   *         schema: { type: integer, minimum: 0 }
   *     responses:
   *       200:
   *         description: Room type
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean }
   *                 data: { $ref: '#/components/schemas/RoomTypeReducedDetail' }
   *       400:
   *         description: Parámetros inválidos
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   *       404:
   *         description: No encontrado
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   *       502:
   *         description: Error Cloudbeds
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   */
  static showRoomTypeById = async (req: Request, res: Response): Promise<void> => {
    try {
      const roomTypeID = asOptionalString(req.params.roomTypeID);
      if (!roomTypeID) {
        res.status(400).json({ error: "roomTypeID es requerido" });
        return;
      }

      const query = req.query as Record<string, unknown>;

      const maxGuests = asOptionalInt(query.maxGuests);
      if (maxGuests !== undefined && maxGuests < 0) {
        res.status(400).json({ error: "maxGuests inválido" });
        return;
      }

      const reduced = await RoomTypesShowService.getRoomTypeReducedDetailWithLocalPricing({ roomTypeID, maxGuests });
      if (!reduced) {
        res.status(404).json({ error: "Room type no encontrado" });
        return;
      }

      res.json({ success: true, data: reduced });
    } catch (error) {
      if (error instanceof RoomsService.CloudbedsHttpError) {
        res.status(error.status || 502).json({ error: formatCloudbedsError(error) });
        return;
      }

      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };
}
