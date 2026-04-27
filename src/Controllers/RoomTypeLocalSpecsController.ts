import type { Request, Response } from "express";
import RoomTypeLocalSpecs from "../models/RoomTypeLocalSpecs";
import mongoose from "mongoose";
import { SupabaseStorageService } from "../services/supabaseStorage.service";
import { CondominiosService } from "../services/condominios.service";
import { parseIdiomaQuery } from "../utils/idioma";
import { RoomTypeTranslationService } from "../services/roomTypeTranslation.service";

/**
 * @openapi
 * /api/room-type-specs:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [RoomTypeSpecs]
 *     summary: Crear metadatos locales de un room type
 *     description: Guarda metadatos locales por roomTypeID (baños + detalle de dormitorios).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateRoomTypeLocalSpecsRequest' }
 *     responses:
 *       201:
 *         description: Creado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/RoomTypeLocalSpecs' }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationErrorResponse' }
 *       409:
 *         description: Duplicado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       503:
 *         description: Base de datos no conectada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 * /api/room-type-specs/{roomTypeID}:
 *   get:
 *     tags: [RoomTypeSpecs]
 *     summary: Obtener metadatos locales por roomTypeID
 *     parameters:
 *       - in: path
 *         name: roomTypeID
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: idioma
 *         required: true
 *         schema: { type: string, enum: [es, en] }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/RoomTypeLocalSpecs' }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationErrorResponse' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       503:
 *         description: Base de datos no conectada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   put:
 *     security: [{ bearerAuth: [] }]
 *     tags: [RoomTypeSpecs]
 *     summary: Actualizar metadatos locales por roomTypeID
 *     parameters:
 *       - in: path
 *         name: roomTypeID
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateRoomTypeLocalSpecsRequest' }
 *         multipart/form-data:
 *           schema: { $ref: '#/components/schemas/UpdateRoomTypeLocalSpecsMultipartRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/RoomTypeLocalSpecs' }
 *       400:
 *         description: Validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ValidationErrorResponse' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       503:
 *         description: Base de datos no conectada
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
const isMongoDuplicateKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === 11000;
};

type BedroomInput = {
  _id?: string;
  clientKey?: string;
  number?: number;
  description?: string;
  keepUrls?: string[];
  photos?: string[];
};

type UpdatePayload = {
  bathroomsCount?: number;
  condominioID?: string;
  bedrooms?: BedroomInput[];
  video_url?: string[];
  extraGalleryImages?: string[];
  pricing?: {
    totalRate?: number;
    ofertaDelMesRoomRate?: number;
  };
};

const toHttpError = (status: number, message: string): Error & { status: number } => {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
};

const isMultipartPayload = (req: Request): boolean => typeof req.body?.payload === "string";

const normalizePayload = (req: Request): UpdatePayload => {
  if (isMultipartPayload(req)) {
    try {
      const parsed = JSON.parse(req.body.payload as string) as UpdatePayload;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("payload debe ser un objeto JSON");
      }
      return parsed;
    } catch (_error) {
      throw toHttpError(400, "payload JSON invalido");
    }
  }

  return req.body as UpdatePayload;
};

type NormalizedFiles = {
  bedroomFilesByKey: Map<string, Express.Multer.File[]>;
  videoFiles: Express.Multer.File[];
  extraGalleryImageFiles: Express.Multer.File[];
};

const normalizeFileMap = (files: Express.Multer.File[]): NormalizedFiles => {
  const bedroomFilesByKey = new Map<string, Express.Multer.File[]>();
  const videoFiles: Express.Multer.File[] = [];
  const extraGalleryImageFiles: Express.Multer.File[] = [];
  const fieldRegex = /^bedroomFiles\[(.+)\]$/;

  for (const file of files) {
    if (file.fieldname === "videoFiles") {
      videoFiles.push(file);
      continue;
    }

    if (file.fieldname === "extraGalleryImageFiles") {
      extraGalleryImageFiles.push(file);
      continue;
    }

    const match = fieldRegex.exec(file.fieldname);
    if (!match) {
      throw toHttpError(
        400,
        `Campo de archivo invalido: ${file.fieldname}. Usa bedroomFiles[<key>], videoFiles o extraGalleryImageFiles`
      );
    }

    const key = match[1].trim();
    if (!key) {
      throw toHttpError(400, "La key de bedroomFiles no puede ser vacia");
    }

    const bucket = bedroomFilesByKey.get(key) ?? [];
    bucket.push(file);
    bedroomFilesByKey.set(key, bucket);
  }

  return { bedroomFilesByKey, videoFiles, extraGalleryImageFiles };
};

const normalizeBedrooms = (value: unknown): BedroomInput[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw toHttpError(400, "bedrooms debe ser un array");

  return value as BedroomInput[];
};

const ensureUniqueBedroomNumbers = (bedrooms: BedroomInput[]): void => {
  const seen = new Set<number>();
  for (const bedroom of bedrooms) {
    if (!Number.isInteger(bedroom.number) || (bedroom.number as number) < 1) {
      throw toHttpError(400, "bedrooms[].number debe ser un entero >= 1");
    }

    const key = bedroom.number as number;
    if (seen.has(key)) {
      throw toHttpError(400, `bedrooms[].number duplicado: ${key}`);
    }
    seen.add(key);
  }
};

const getBedroomKeys = (bedroom: BedroomInput): string[] => {
  const keys: string[] = [];
  if (typeof bedroom._id === "string" && bedroom._id.trim().length > 0) keys.push(bedroom._id.trim());
  if (typeof bedroom.clientKey === "string" && bedroom.clientKey.trim().length > 0) keys.push(bedroom.clientKey.trim());
  if (typeof bedroom.number === "number" && Number.isInteger(bedroom.number) && bedroom.number > 0) {
    keys.push(String(bedroom.number));
  }
  return Array.from(new Set(keys));
};

const normalizeKeptUrls = (bedroom: BedroomInput): string[] => {
  const source = Array.isArray(bedroom.keepUrls) ? bedroom.keepUrls : Array.isArray(bedroom.photos) ? bedroom.photos : [];
  return source.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
};

const normalizeStringArray = (value: unknown, fieldName: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw toHttpError(400, `${fieldName} debe ser un array de strings`);
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const normalizePricing = (
  value: unknown,
  fieldName = "pricing"
): { totalRate?: number; ofertaDelMesRoomRate?: number } | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw toHttpError(400, `${fieldName} debe ser un objeto`);
  }

  const record = value as { totalRate?: unknown; ofertaDelMesRoomRate?: unknown };
  const normalized: { totalRate?: number; ofertaDelMesRoomRate?: number } = {};

  if (record.totalRate !== undefined) {
    if (typeof record.totalRate !== "number" || !Number.isFinite(record.totalRate) || record.totalRate < 0) {
      throw toHttpError(400, `${fieldName}.totalRate debe ser un number >= 0`);
    }
    normalized.totalRate = record.totalRate;
  }

  if (record.ofertaDelMesRoomRate !== undefined) {
    if (
      typeof record.ofertaDelMesRoomRate !== "number" ||
      !Number.isFinite(record.ofertaDelMesRoomRate) ||
      record.ofertaDelMesRoomRate < 0
    ) {
      throw toHttpError(400, `${fieldName}.ofertaDelMesRoomRate debe ser un number >= 0`);
    }
    normalized.ofertaDelMesRoomRate = record.ofertaDelMesRoomRate;
  }

  return normalized;
};

const assertImageFiles = (files: Express.Multer.File[], fieldName: string): void => {
  for (const file of files) {
    const mimeType = typeof file.mimetype === "string" ? file.mimetype.toLowerCase() : "";
    if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
      throw toHttpError(400, `${fieldName} solo acepta archivos jpg/png`);
    }
  }
};

const assertVideoFiles = (files: Express.Multer.File[], fieldName: string): void => {
  for (const file of files) {
    const mimeType = typeof file.mimetype === "string" ? file.mimetype.toLowerCase() : "";
    if (!mimeType.startsWith("video/")) {
      throw toHttpError(400, `${fieldName} solo acepta archivos de video`);
    }
  }
};

export class RoomTypeLocalSpecsController {
  static create = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { roomTypeID, bedrooms, bathroomsCount, condominioID, video_url, extraGalleryImages, pricing } = req.body as {
        roomTypeID: string;
        bathroomsCount: number;
        bedrooms: Array<{ number: number; description?: string; photos?: string[] }>;
        condominioID?: string;
        video_url?: string[];
        extraGalleryImages?: string[];
        pricing?: {
          totalRate?: number;
          ofertaDelMesRoomRate?: number;
        };
      };

      const normalizedVideoUrls = normalizeStringArray(video_url, "video_url") ?? [];
      const normalizedExtraGalleryImages = normalizeStringArray(extraGalleryImages, "extraGalleryImages") ?? [];
      const normalizedPricing = normalizePricing(pricing, "pricing");

      const doc = await RoomTypeLocalSpecs.create({
        roomTypeID,
        bathroomsCount,
        condominioID: typeof condominioID === "string" ? new mongoose.Types.ObjectId(condominioID) : undefined,
        bedrooms: Array.isArray(bedrooms)
          ? bedrooms.map((b) => ({
              number: b.number,
              description: typeof b.description === "string" ? b.description : undefined,
              photos: Array.isArray(b.photos) ? b.photos : [],
            }))
          : [],
        video_url: normalizedVideoUrls,
        extraGalleryImages: normalizedExtraGalleryImages,
        pricing: normalizedPricing,
      });
      res.status(201).json({ success: true, data: doc });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        res.status(409).json({ error: "Ya existe un registro con ese roomTypeID" });
        return;
      }
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static getByRoomTypeID = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const idioma = parseIdiomaQuery((req.query as Record<string, unknown>).idioma);
      if (!idioma) {
        res.status(400).json({ error: "idioma es requerido (es|en)" });
        return;
      }

      const { roomTypeID } = req.params;
      const doc = await RoomTypeLocalSpecs.findOne({ roomTypeID }).lean();
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      const condominioID = doc.condominioID ? String(doc.condominioID) : null;
      const mapUrl = condominioID ? await CondominiosService.getMapUrlById(condominioID) : null;

      const payload = { success: true, data: { ...doc, condominioID, mapUrl } };
      if (idioma === "en") {
        const translated = await RoomTypeTranslationService.translateRoomTypeSpecsPayloadToEnglish(payload);
        res.json(translated);
        return;
      }

      res.json(payload);
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static updateByRoomTypeID = async (req: Request, res: Response): Promise<void> => {
    const uploadedFileIds: string[] = [];

    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const { roomTypeID } = req.params;

      const payload = normalizePayload(req);
      const bathroomsCount = payload.bathroomsCount;
      const condominioID = payload.condominioID;
      const bedrooms = normalizeBedrooms(payload.bedrooms);
      const videoUrls = normalizeStringArray(payload.video_url, "video_url");
      const extraGalleryImages = normalizeStringArray(payload.extraGalleryImages, "extraGalleryImages");
      const pricing = normalizePricing(payload.pricing, "pricing");
      const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
      const { bedroomFilesByKey, videoFiles, extraGalleryImageFiles } = normalizeFileMap(files);

      assertVideoFiles(videoFiles, "videoFiles");
      assertImageFiles(extraGalleryImageFiles, "extraGalleryImageFiles");

      if (
        bedrooms.length === 0 &&
        bathroomsCount === undefined &&
        condominioID === undefined &&
        videoUrls === undefined &&
        extraGalleryImages === undefined &&
        pricing === undefined &&
        videoFiles.length === 0 &&
        extraGalleryImageFiles.length === 0
      ) {
        res
          .status(400)
          .json({ error: "Debes enviar bedrooms y/o bathroomsCount y/o condominioID y/o video_url y/o extraGalleryImages y/o pricing" });
        return;
      }

      if (bathroomsCount !== undefined && (!Number.isInteger(bathroomsCount) || bathroomsCount < 0)) {
        res.status(400).json({ error: "bathroomsCount debe ser un entero >= 0" });
        return;
      }

      if (condominioID !== undefined && !mongoose.Types.ObjectId.isValid(condominioID)) {
        res.status(400).json({ error: "condominioID debe ser un ObjectId valido" });
        return;
      }

      if (bedrooms.length > 0) {
        ensureUniqueBedroomNumbers(bedrooms);
      }

      const update: Partial<{
        bathroomsCount: number;
        condominioID: mongoose.Types.ObjectId;
        bedrooms: Array<{ number: number; description?: string; photos: string[] }>;
        video_url: string[];
        extraGalleryImages: string[];
        pricing: {
          totalRate?: number;
          ofertaDelMesRoomRate?: number;
        };
      }> = {};

      if (bathroomsCount !== undefined) update.bathroomsCount = bathroomsCount;
      if (condominioID !== undefined) update.condominioID = new mongoose.Types.ObjectId(condominioID);
      if (pricing !== undefined) update.pricing = pricing;

      if (bedrooms.length > 0 || files.length > 0) {
        const normalizedBedrooms: Array<{ number: number; description?: string; photos: string[] }> = [];

        for (const bedroom of bedrooms) {
          const keys = getBedroomKeys(bedroom);
          const fileCandidates = keys.flatMap((key) => bedroomFilesByKey.get(key) ?? []);

          for (const key of keys) bedroomFilesByKey.delete(key);

          const uploadedUrls: string[] = [];
          for (const file of fileCandidates) {
            const uploaded = await SupabaseStorageService.uploadFile({
              fileBuffer: file.buffer,
              originalName: file.originalname,
              mimeType: file.mimetype,
            });
            uploadedFileIds.push(uploaded.fileId);
            uploadedUrls.push(uploaded.url);
          }

          const keptUrls = normalizeKeptUrls(bedroom);
          const photos = Array.from(new Set([...keptUrls, ...uploadedUrls]));

          normalizedBedrooms.push({
            number: bedroom.number as number,
            description: typeof bedroom.description === "string" ? bedroom.description : undefined,
            photos,
          });
        }

        if (bedroomFilesByKey.size > 0) {
          const orphanKeys = Array.from(bedroomFilesByKey.keys());
          throw toHttpError(400, `Hay archivos sin dormitorio en payload: ${orphanKeys.join(", ")}`);
        }

        update.bedrooms = normalizedBedrooms;
      }

      if (videoUrls !== undefined || videoFiles.length > 0) {
        const uploadedVideoUrls: string[] = [];
        for (const file of videoFiles) {
          const uploaded = await SupabaseStorageService.uploadFile({
            fileBuffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            mediaKind: "video",
          });
          uploadedFileIds.push(uploaded.fileId);
          uploadedVideoUrls.push(uploaded.url);
        }

        update.video_url = Array.from(new Set([...(videoUrls ?? []), ...uploadedVideoUrls]));
      }

      if (extraGalleryImages !== undefined || extraGalleryImageFiles.length > 0) {
        const uploadedImageUrls: string[] = [];
        for (const file of extraGalleryImageFiles) {
          const uploaded = await SupabaseStorageService.uploadFile({
            fileBuffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            mediaKind: "image",
          });
          uploadedFileIds.push(uploaded.fileId);
          uploadedImageUrls.push(uploaded.url);
        }

        update.extraGalleryImages = Array.from(new Set([...(extraGalleryImages ?? []), ...uploadedImageUrls]));
      }

      const doc = await RoomTypeLocalSpecs.findOneAndUpdate({ roomTypeID }, update, {
        new: true,
        runValidators: true,
      }).lean();

      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true, data: doc });
    } catch (error) {
      if (uploadedFileIds.length > 0) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => SupabaseStorageService.deleteFile({ fileId })));
      }

      const status = typeof (error as { status?: unknown })?.status === "number" ? ((error as { status: number }).status as number) : 500;
      if (status !== 500) {
        res.status(status).json({ error: (error as Error).message || "Error de validacion" });
        return;
      }

      res.status(500).json({ error: "Error interno del servidor" });
    }
  };
}
