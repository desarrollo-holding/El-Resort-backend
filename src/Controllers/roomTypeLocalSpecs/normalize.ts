import mongoose from "mongoose";
import type { Request } from "express";
import { toHttpError } from "../../utils/errors";

export const isMongoDuplicateKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === 11000;
};

export type BedroomInput = {
  _id?: string;
  clientKey?: string;
  number?: number;
  description?: string;
  keepUrls?: string[];
  photos?: string[];
};

export type UpdatePayload = {
  portada?: string | null;
  portadaMenu?: string | null;
  mapaUbicacion?: string | null;
  bathroomsCount?: number;
  titleColor?: string | null;
  condominioID?: string;
  bedrooms?: BedroomInput[];
  video_url?: string[];
  video_url_mobile?: string[];
  extraGalleryImages?: string[];
  portada_video?: string | null;
  pricing?: {
    totalRate?: number;
    ofertaDelMesRoomRate?: number;
  };
  posicion_fotos_portadas?: Record<string, unknown> | null;
  /** Ids del catálogo de beneficios; llega como array de strings desde el dashboard. */
  beneficios?: string[];
  roomTypeName?: { es?: string; en?: string | null };
  roomTypeDescription?: { es?: string; en?: string | null };
  /** Huéspedes máximos local; `null` explícito borra el override y cae a Cloudbeds. */
  maxGuests?: number | null;
};

export const isMultipartPayload = (req: Request): boolean => typeof req.body?.payload === "string";

export const normalizePayload = (req: Request): UpdatePayload => {
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

export type NormalizedFiles = {
  bedroomFilesByKey: Map<string, Express.Multer.File[]>;
  videoFiles: Express.Multer.File[];
  videoMobileFiles: Express.Multer.File[];
  extraGalleryImageFiles: Express.Multer.File[];
  portadaVideoImageFiles: Express.Multer.File[];
  portadaImageFiles: Express.Multer.File[];
  portadaMenuImageFiles: Express.Multer.File[];
  mapaUbicacionImageFiles: Express.Multer.File[];
};

export const normalizeFileMap = (files: Express.Multer.File[]): NormalizedFiles => {
  const bedroomFilesByKey = new Map<string, Express.Multer.File[]>();
  const videoFiles: Express.Multer.File[] = [];
  const videoMobileFiles: Express.Multer.File[] = [];
  const extraGalleryImageFiles: Express.Multer.File[] = [];
  const portadaVideoImageFiles: Express.Multer.File[] = [];
  const portadaImageFiles: Express.Multer.File[] = [];
  const portadaMenuImageFiles: Express.Multer.File[] = [];
  const mapaUbicacionImageFiles: Express.Multer.File[] = [];
  const fieldRegex = /^bedroomFiles\[(.+)\]$/;

  for (const file of files) {
    if (file.fieldname === "videoFiles") {
      videoFiles.push(file);
      continue;
    }

    if (file.fieldname === "videoMobileFiles") {
      videoMobileFiles.push(file);
      continue;
    }

    if (file.fieldname === "extraGalleryImageFiles") {
      extraGalleryImageFiles.push(file);
      continue;
    }

    if (file.fieldname === "portadaVideoImageFiles") {
      portadaVideoImageFiles.push(file);
      continue;
    }

    if (file.fieldname === "portadaImageFiles") {
      portadaImageFiles.push(file);
      continue;
    }

    if (file.fieldname === "portadaMenuImageFiles") {
      portadaMenuImageFiles.push(file);
      continue;
    }

    if (file.fieldname === "mapaUbicacionImageFiles") {
      mapaUbicacionImageFiles.push(file);
      continue;
    }

    const match = fieldRegex.exec(file.fieldname);
    if (!match) {
      throw toHttpError(
        400,
        `Campo de archivo invalido: ${file.fieldname}. Usa bedroomFiles[<key>], videoFiles, videoMobileFiles o extraGalleryImageFiles`
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

  return { bedroomFilesByKey, videoFiles, videoMobileFiles, extraGalleryImageFiles, portadaVideoImageFiles, portadaImageFiles, portadaMenuImageFiles, mapaUbicacionImageFiles };
};

export const normalizeBedrooms = (value: unknown): BedroomInput[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw toHttpError(400, "bedrooms debe ser un array");

  return value as BedroomInput[];
};

export const ensureUniqueBedroomNumbers = (bedrooms: BedroomInput[]): void => {
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

export const getBedroomKeys = (bedroom: BedroomInput): string[] => {
  const keys: string[] = [];
  if (typeof bedroom._id === "string" && bedroom._id.trim().length > 0) keys.push(bedroom._id.trim());
  if (typeof bedroom.clientKey === "string" && bedroom.clientKey.trim().length > 0) keys.push(bedroom.clientKey.trim());
  if (typeof bedroom.number === "number" && Number.isInteger(bedroom.number) && bedroom.number > 0) {
    keys.push(String(bedroom.number));
  }
  return Array.from(new Set(keys));
};

export const normalizeKeptUrls = (bedroom: BedroomInput): string[] => {
  const source = Array.isArray(bedroom.keepUrls) ? bedroom.keepUrls : Array.isArray(bedroom.photos) ? bedroom.photos : [];
  return source.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
};

export const normalizeStringArray = (value: unknown, fieldName: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw toHttpError(400, `${fieldName} debe ser un array de strings`);
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

/** Ids del catálogo de beneficios que la propiedad muestra; un array vacío los quita todos. */
export const normalizeBeneficios = (
  value: unknown,
  fieldName = "beneficios"
): mongoose.Types.ObjectId[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw toHttpError(400, `${fieldName} debe ser un array de ObjectId`);
  }

  const ids = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const invalid = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length > 0) {
    throw toHttpError(400, `${fieldName} tiene ids invalidos: ${invalid.join(", ")}`);
  }

  // Set: el mismo beneficio marcado dos veces no debe duplicarse en la ficha.
  return Array.from(new Set(ids)).map((id) => new mongoose.Types.ObjectId(id));
};

/** `{es, en}` para nombre/descripción locales; `en` se resuelve después vía traducción si no viene. */
export const normalizeTranslatableText = (
  value: unknown,
  fieldName: string
): { es: string; en?: string | null } | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw toHttpError(400, `${fieldName} debe ser un objeto { es, en }`);
  }

  const record = value as { es?: unknown; en?: unknown };
  if (typeof record.es !== "string") {
    throw toHttpError(400, `${fieldName}.es debe ser un string`);
  }

  const en =
    record.en === null || record.en === undefined
      ? undefined
      : typeof record.en === "string"
        ? record.en
        : undefined;

  return { es: record.es.trim(), en };
};

export const normalizePricing = (
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

export const assertImageFiles = (files: Express.Multer.File[], fieldName: string): void => {
  for (const file of files) {
    const mimeType = typeof file.mimetype === "string" ? file.mimetype.toLowerCase() : "";
    if (!mimeType.startsWith("image/")) {
      throw toHttpError(400, `${fieldName} solo acepta archivos de imagen (png, jpg, webp, svg, etc.)`);
    }
  }
};

/** Contenedores de video habituales; el formato lo elige el admin, acá no se acota a uno. */
const VIDEO_FILE_EXTENSION_RE = /\.(mp4|m4v|webm|mov|ogv|ogg|avi|mkv|mpe?g|3gp|wmv|flv|ts|mts)$/i;

/**
 * Acepta por MIME **o** por extensión, y no rechaza por un MIME genérico. Windows y varios
 * navegadores móviles mandan un `.webm` o un `.mov` como `application/octet-stream` (o sin MIME):
 * exigir `video/*` devolvía un 400 sobre archivos válidos, y el admin solo veía que la subida
 * "no funcionaba". Solo se rechaza lo que declara ser otra cosa y encima no tiene extensión de
 * video (una imagen, un PDF).
 */
export const assertVideoFiles = (files: Express.Multer.File[], fieldName: string): void => {
  for (const file of files) {
    const mimeType = typeof file.mimetype === "string" ? file.mimetype.trim().toLowerCase() : "";
    const originalName = typeof file.originalname === "string" ? file.originalname : "";

    if (!mimeType || mimeType === "application/octet-stream") continue;
    if (mimeType.startsWith("video/")) continue;
    if (VIDEO_FILE_EXTENSION_RE.test(originalName)) continue;

    throw toHttpError(400, `${fieldName} solo acepta archivos de video (llego ${mimeType})`);
  }
};

/** Slug en minúsculas sin acentos, solo [a-z0-9-], para usar como roomTypeID autogenerado. */
export const slugifyRoomTypeName = (name: string): string => {
  const base = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base.length > 0 ? base : "propiedad";
};

/** roomTypeID candidato con un sufijo numérico incremental, para reintentar en caso de colisión. */
export const buildRoomTypeIdCandidate = (baseSlug: string, attempt: number): string =>
  attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
