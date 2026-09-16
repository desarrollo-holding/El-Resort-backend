import type { Request, Response } from "express";
import RoomTypeLocalSpecs from "../../models/RoomTypeLocalSpecs";
import mongoose from "mongoose";
import type { AnyBulkWriteOperation } from "mongoose";
import { isMongoDuplicateKeyError, slugifyRoomTypeName, buildRoomTypeIdCandidate } from "./normalize";
import { fetchCloudbedsRoomTypesMapSafe, fetchCloudbedsRatesMapSafe } from "./cloudbedsEnrichment";
import { RoomTypeLocalTextService } from "../../services/roomTypeLocalText.service";

import { sendErrorResponse } from "../../utils/errors";
const MAX_ROOM_TYPE_ID_ATTEMPTS = 30;

export const updateOrderBulk = async (req: Request, res: Response): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    // Normalizar payload: aceptar array o object indexado numericamente ("0": {...})
    let payloadRaw: unknown = req.body;
    if (!Array.isArray(payloadRaw) && payloadRaw && typeof payloadRaw === "object") {
      const keys = Object.keys(payloadRaw as Record<string, unknown>);
      const numericKeys = keys.filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
      if (numericKeys.length > 0 && numericKeys.length === keys.length) {
        payloadRaw = numericKeys.map((k) => (payloadRaw as Record<string, unknown>)[k]);
      }
    }

    const payload = payloadRaw as Array<{ roomTypeID: string; orden: number }>;
    if (!Array.isArray(payload) || payload.length === 0) {
      res.status(400).json({ error: "Debe enviar un array con objetos { roomTypeID, orden }" });
      return;
    }

    const seen = new Set<string>();
    const operations: AnyBulkWriteOperation<any>[] = [];
    const ids: string[] = [];

    for (const item of payload) {
      if (!item || typeof item !== "object") continue;
      const roomTypeID = typeof item.roomTypeID === "string" ? item.roomTypeID.trim() : "";
      const orden = item.orden;
      if (!roomTypeID) continue;
      if (!Number.isInteger(orden) || orden < 1) {
        res.status(400).json({ error: "orden debe ser un entero >= 1" });
        return;
      }
      if (seen.has(roomTypeID)) continue;
      seen.add(roomTypeID);
      ids.push(roomTypeID);

      operations.push({ updateOne: { filter: { roomTypeID }, update: { $set: { orden } } } });
    }

    // Primero aplicar los updates especificados
    if (operations.length > 0) {
      await RoomTypeLocalSpecs.bulkWrite(operations, { ordered: false });
    }

    // Luego, quitar orden de los que no fueron incluidos (se ponen al final)
    await RoomTypeLocalSpecs.updateMany({ roomTypeID: { $nin: ids } }, { $unset: { orden: "" } });

    res.json({ success: true });
  } catch (error) {
    sendErrorResponse(res, error, "Error al guardar el orden de las habitaciones");
  }
};

export const getAllAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    const docs = await RoomTypeLocalSpecs.find({})
      .sort({ orden: 1, createdAt: 1 })
      .lean();

    // Enriquecer con datos de CloudBeds (nombre, fotos, descripción, precios)
    const cloudbedsMap = await fetchCloudbedsRoomTypesMapSafe();
    const cloudbedsRatesMap = await fetchCloudbedsRatesMapSafe();

    const enriched = docs.map((doc) => {
      const cb = cloudbedsMap.get(doc.roomTypeID);
      const cbRates = cloudbedsRatesMap.get(doc.roomTypeID);
      const localPricing = doc.pricing as Record<string, unknown> | undefined;
      const localTotalRate = localPricing && typeof localPricing.totalRate === "number" ? localPricing.totalRate : undefined;

      // Precio: local si existe y > 0, si no CloudBeds baseRate
      const resolvedTotalRate = (localTotalRate != null && localTotalRate > 0)
        ? localTotalRate
        : cbRates?.totalRate;
      const localOferta = localPricing && typeof localPricing.ofertaDelMesRoomRate === "number" ? localPricing.ofertaDelMesRoomRate : undefined;
      const resolvedOferta = (localOferta != null && localOferta > 0)
        ? localOferta
        : cbRates?.ofertaRate;

      const base: Record<string, unknown> = { ...doc };
      base.pricing = {
        totalRate: resolvedTotalRate ?? 0,
        ofertaDelMesRoomRate: resolvedOferta ?? 0,
      };
      base.pricingSource = (localTotalRate != null && localTotalRate > 0) ? "local" : "cloudbeds";

      // Local manda si tiene contenido; Cloudbeds solo se usa de respaldo. A diferencia de
      // getByRoomTypeID (editor, necesita {es, en}), este listado es de solo lectura para la
      // tarjeta del dashboard — se aplana a string, el mismo contrato que ya tenía.
      const localName = base.roomTypeName as { es?: string; en?: string | null } | undefined;
      base.roomTypeName =
        localName?.es && localName.es.trim().length > 0
          ? localName.es
          : typeof cb?.roomTypeName === "string"
            ? cb.roomTypeName
            : undefined;

      const localDescription = base.roomTypeDescription as { es?: string; en?: string | null } | undefined;
      base.roomTypeDescription =
        localDescription?.es && localDescription.es.trim().length > 0
          ? localDescription.es
          : typeof cb?.roomTypeDescription === "string"
            ? cb.roomTypeDescription
            : undefined;

      if (!cb) return base;
      base.roomTypePhotos = Array.isArray(cb.roomTypePhotos) ? cb.roomTypePhotos : undefined;
      // Local manda si tiene un valor seteado; Cloudbeds solo se usa de respaldo.
      const localMaxGuests = typeof base.maxGuests === "number" ? base.maxGuests : undefined;
      base.maxGuests = localMaxGuests ?? (typeof cb.maxGuests === "number" ? cb.maxGuests : undefined);
      base.roomTypeFeatures = Array.isArray(cb.roomTypeFeatures) ? cb.roomTypeFeatures : undefined;
      return base;
    });

    res.json({ success: true, data: enriched });
  } catch (error) {
    sendErrorResponse(res, error, "Error al obtener las fichas de las habitaciones");
  }
};

export const softDelete = async (req: Request, res: Response): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    const { roomTypeID } = req.params;
    const doc = await RoomTypeLocalSpecs.findOneAndUpdate(
      { roomTypeID },
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!doc) {
      res.status(404).json({ error: "No encontrado" });
      return;
    }

    res.json({ success: true, data: doc });
  } catch (error) {
    sendErrorResponse(res, error, "Error al desactivar la ficha de la habitación");
  }
};

export const reactivate = async (req: Request, res: Response): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    const { roomTypeID } = req.params;
    const doc = await RoomTypeLocalSpecs.findOneAndUpdate(
      { roomTypeID },
      { $set: { isActive: true } },
      { new: true }
    ).lean();

    if (!doc) {
      res.status(404).json({ error: "No encontrado" });
      return;
    }

    res.json({ success: true, data: doc });
  } catch (error) {
    sendErrorResponse(res, error, "Error al reactivar la ficha de la habitación");
  }
};

export const duplicate = async (req: Request, res: Response): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({
        error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
        code: "DATABASE_UNAVAILABLE",
        hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
      });
      return;
    }

    const { sourceRoomTypeID, newRoomTypeName } = req.body as {
      sourceRoomTypeID: string;
      newRoomTypeName: string;
    };

    const newRoomTypeNameEs = typeof newRoomTypeName === "string" ? newRoomTypeName.trim() : "";
    if (!sourceRoomTypeID || !newRoomTypeNameEs) {
      res.status(400).json({ error: "sourceRoomTypeID y newRoomTypeName son requeridos" });
      return;
    }

    const source = await RoomTypeLocalSpecs.findOne({ roomTypeID: sourceRoomTypeID }).lean();
    if (!source) {
      res.status(404).json({ error: "Propiedad origen no encontrada" });
      return;
    }

    const { _id, roomTypeID, createdAt, updatedAt, roomTypeName, ...rest } = source as any;
    const newRoomTypeNameResolved = {
      es: newRoomTypeNameEs,
      en: await RoomTypeLocalTextService.resolveEnglishText(newRoomTypeNameEs, undefined),
    };
    const baseSlug = slugifyRoomTypeName(newRoomTypeNameEs);
    const buildDuplicateData = (candidateID: string) => ({
      ...rest,
      roomTypeID: candidateID,
      roomTypeName: newRoomTypeNameResolved,
      isActive: true,
      portada: rest.portada ?? null,
      portadaMenu: rest.portadaMenu ?? null,
      portada_video: rest.portada_video ?? null,
    });

    let doc;
    for (let attempt = 0; attempt < MAX_ROOM_TYPE_ID_ATTEMPTS; attempt++) {
      const candidateID = buildRoomTypeIdCandidate(baseSlug, attempt);
      try {
        doc = await RoomTypeLocalSpecs.create(buildDuplicateData(candidateID));
        break;
      } catch (createError) {
        const isLastAttempt = attempt === MAX_ROOM_TYPE_ID_ATTEMPTS - 1;
        if (!isMongoDuplicateKeyError(createError) || isLastAttempt) throw createError;
      }
    }

    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      res.status(409).json({ error: "Ya existe un registro con ese roomTypeID" });
      return;
    }
    sendErrorResponse(res, error, "Error al duplicar la ficha de la habitación");
  }
};
