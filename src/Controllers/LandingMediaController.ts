import type { Request, Response } from "express";
import mongoose from "mongoose";
import { LANDING_MEDIA_TIPOS, type LandingMediaTipo } from "../models/LandingMedia";
import { LandingMediaService } from "../services/landingMedia.service";
import { GcsStorageService } from "../services/csStorage.service";

type JsonRecord = Record<string, unknown>;
type JsonLike = null | boolean | number | string | JsonLike[] | JsonRecord;
type MediaKind = "image" | "video" | "file";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"]);

const isObjectRecord = (value: unknown): value is JsonRecord => !!value && typeof value === "object" && !Array.isArray(value);

const getExtension = (value: string): string => {
  const noQuery = value.split("?")[0].split("#")[0];
  const idx = noQuery.lastIndexOf(".");
  if (idx < 0) return "";
  return noQuery.slice(idx).toLowerCase();
};

const detectMediaKind = (source: { src?: string; mimeType?: string; currentKind?: unknown }): MediaKind => {
  const mimeType = typeof source.mimeType === "string" ? source.mimeType.trim().toLowerCase() : "";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";

  const src = typeof source.src === "string" ? source.src.trim().toLowerCase() : "";
  const ext = getExtension(src);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";

  const currentKind = typeof source.currentKind === "string" ? source.currentKind.trim().toLowerCase() : "";
  if (currentKind === "image") return "image";
  if (currentKind === "video") return "video";

  return "file";
};

const parsePayload = (req: Request): JsonRecord => {
  if (typeof req.body?.payload === "string") {
    try {
      const parsed = JSON.parse(req.body.payload) as unknown;
      if (!isObjectRecord(parsed)) throw new Error("payload debe ser un objeto");
      return parsed;
    } catch {
      throw Object.assign(new Error("payload JSON invalido"), { status: 400 });
    }
  }

  if (!isObjectRecord(req.body)) {
    throw Object.assign(new Error("Body invalido"), { status: 400 });
  }

  return req.body as JsonRecord;
};

const normalizeFilesMap = (files: Express.Multer.File[]): Map<string, Express.Multer.File[]> => {
  const fileMap = new Map<string, Express.Multer.File[]>();
  const fieldRegex = /^mediaFiles\[(.+)\]$/;

  for (const file of files) {
    const match = fieldRegex.exec(file.fieldname);
    if (!match) {
      throw Object.assign(new Error(`Campo de archivo invalido: ${file.fieldname}. Usa mediaFiles[<key>]`), { status: 400 });
    }

    const key = match[1].trim();
    if (!key) {
      throw Object.assign(new Error("La key de mediaFiles no puede ser vacia"), { status: 400 });
    }

    const bucket = fileMap.get(key) ?? [];
    bucket.push(file);
    fileMap.set(key, bucket);
  }

  return fileMap;
};

const isDirectUrl = (value: string): boolean => /^https?:\/\//i.test(value);
const isFrontendLocalPath = (value: string): boolean => /^(src\/|\.\/|\.\.\/|assets\/)/i.test(value);
const isMediaRef = (value: string): boolean => /^media:\/\//i.test(value);

const normalizeJsonMediaNodes = async (
  value: JsonLike,
  filesByKey: Map<string, Express.Multer.File[]>,
  uploadedFileIds: string[]
): Promise<JsonLike> => {
  if (Array.isArray(value)) {
    const normalizedItems = await Promise.all(value.map((item) => normalizeJsonMediaNodes(item as JsonLike, filesByKey, uploadedFileIds)));
    return normalizedItems;
  }

  if (!isObjectRecord(value)) return value;

  if (typeof value.src === "string") {
    const normalizedSrcInput = value.src.trim();
    let finalSrc = normalizedSrcInput;
    let mimeTypeForKind: string | undefined;

    if (isMediaRef(normalizedSrcInput)) {
      const key = normalizedSrcInput.replace(/^media:\/\//i, "").trim();
      if (!key) {
        throw Object.assign(new Error("src media:// requiere una key"), { status: 400 });
      }

      const files = filesByKey.get(key) ?? [];
      if (files.length === 0) {
        throw Object.assign(new Error(`No se encontro archivo para media key: ${key}`), { status: 400 });
      }
      if (files.length > 1) {
        throw Object.assign(new Error(`Solo se permite un archivo por media key: ${key}`), { status: 400 });
      }

      const file = files[0];
      const requestedKind = detectMediaKind({ src: normalizedSrcInput, currentKind: value.kind });

      const uploaded = await GcsStorageService.uploadFile({
        fileBuffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        mediaKind: requestedKind,
        imageConstraints: undefined,
      });

      uploadedFileIds.push(uploaded.fileId);
      finalSrc = uploaded.url;
      mimeTypeForKind = file.mimetype;
      filesByKey.delete(key);
    } else if (isDirectUrl(normalizedSrcInput)) {
      finalSrc = normalizedSrcInput;
    } else if (isFrontendLocalPath(normalizedSrcInput)) {
      throw Object.assign(
        new Error(`src local no soportado (${normalizedSrcInput}). Usa media://<key> + mediaFiles[<key>] o URL publica`),
        { status: 400 }
      );
    } else {
      throw Object.assign(new Error(`src invalido: ${normalizedSrcInput}`), { status: 400 });
    }

    const normalizedMediaNode: JsonRecord = {
      ...value,
      src: finalSrc,
      kind: detectMediaKind({ src: finalSrc, mimeType: mimeTypeForKind, currentKind: value.kind }),
      status: "existing",
    };

    for (const [k, v] of Object.entries(normalizedMediaNode)) {
      if (k === "src" || k === "kind" || k === "status") continue;
      normalizedMediaNode[k] = await normalizeJsonMediaNodes(v as JsonLike, filesByKey, uploadedFileIds);
    }

    return normalizedMediaNode;
  }

  const normalizedObject: JsonRecord = {};
  for (const [k, v] of Object.entries(value)) {
    normalizedObject[k] = await normalizeJsonMediaNodes(v as JsonLike, filesByKey, uploadedFileIds);
  }

  return normalizedObject;
};

const parseTipo = (value: unknown): LandingMediaTipo => {
  const tipo = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!LANDING_MEDIA_TIPOS.includes(tipo as LandingMediaTipo)) {
    throw Object.assign(new Error("tipo debe ser SECCION o GLOBAL"), { status: 400 });
  }
  return tipo as LandingMediaTipo;
};

const parseSectionId = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw Object.assign(new Error("sectionId debe ser string o null"), { status: 400 });
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!mongoose.Types.ObjectId.isValid(trimmed)) {
    throw Object.assign(new Error("sectionId debe ser ObjectId valido"), { status: 400 });
  }
  return trimmed;
};

const parseNombre = (value: unknown): string => {
  const nombre = typeof value === "string" ? value.trim() : "";
  if (!nombre) {
    throw Object.assign(new Error("nombre es requerido"), { status: 400 });
  }
  return nombre;
};

const parseJsonField = (value: unknown): JsonLike => {
  if (value === undefined) {
    throw Object.assign(new Error("json es requerido"), { status: 400 });
  }
  return value as JsonLike;
};

const parsePositiveIntQuery = (value: unknown, field: string, fallback: number): number => {
  if (value === undefined || value === null || value === "") return fallback;

  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw Object.assign(new Error(`${field} debe ser un entero > 0`), { status: 400 });
  }

  return parsed;
};

const parseBooleanQuery = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === "") return fallback;

  const normalized = String(Array.isArray(value) ? value[0] : value)
    .trim()
    .toLowerCase();

  if (["1", "true", "yes", "si"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;

  throw Object.assign(new Error("signed debe ser booleano (true/false o 1/0)"), { status: 400 });
};

const parseStorageDeletePaths = (value: unknown): string[] => {
  if (!value || typeof value !== "object") {
    throw Object.assign(new Error("Body invalido"), { status: 400 });
  }

  const body = value as { path?: unknown; paths?: unknown };
  const collected: string[] = [];

  if (typeof body.path === "string") {
    const normalized = body.path.trim();
    if (!normalized) {
      throw Object.assign(new Error("path no puede ser vacio"), { status: 400 });
    }
    collected.push(normalized);
  }

  if (Array.isArray(body.paths)) {
    for (const item of body.paths) {
      if (typeof item !== "string") {
        throw Object.assign(new Error("paths debe contener solo strings"), { status: 400 });
      }

      const normalized = item.trim();
      if (!normalized) {
        throw Object.assign(new Error("paths no puede contener valores vacios"), { status: 400 });
      }

      collected.push(normalized);
    }
  }

  const normalizedPaths = Array.from(new Set(collected));
  if (normalizedPaths.length === 0) {
    throw Object.assign(new Error("Debes enviar path o paths[]"), { status: 400 });
  }

  if (normalizedPaths.length > 1000) {
    throw Object.assign(new Error("No puedes eliminar mas de 1000 archivos por request"), { status: 400 });
  }

  return normalizedPaths;
};

/**
 * @openapi
 * /api/landing-media:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [LandingMedia]
 *     summary: Crear configuración de media de landing
 *     description: |
 *       Permite enviar json con nodos media (src/kind/status).
 *       Si src usa media://<key>, debes adjuntar mediaFiles[<key>] y se reemplaza por URL publica.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [payload]
 *             properties:
 *               payload:
 *                 type: string
 *                 description: |
 *                   JSON string con forma { tipo, nombre, sectionId, json }.
 *                   Para cada media nueva en json usa src: "media://<key>".
 *                 example: '{"tipo":"SECCION","nombre":"landing-home","sectionId":"67fbe2b9f95aab97d58f4c2a","json":{"heroVideo":{"src":"media://heroVideo","kind":"video","status":"existing"},"tripadvisorBadge":{"src":"media://tripadvisorBadge","kind":"image","status":"existing"}}}'
 *               mediaFiles:
 *                 type: array
 *                 description: |
 *                   Archivos nuevos. En form-data cada campo debe llamarse mediaFiles[<key>]
 *                   y <key> debe coincidir con src="media://<key>" en el payload.
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Creado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     tipo: { type: string, enum: [SECCION, GLOBAL] }
 *                     nombre: { type: string }
 *                     sectionId: { type: string, nullable: true }
 *                     json: { type: object, additionalProperties: true }
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
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
 *   get:
 *     tags: [LandingMedia]
 *     summary: Obtener toda la media consolidada
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 globals:
 *                   type: object
 *                   additionalProperties: true
 *                 sections:
 *                   type: object
 *                   additionalProperties: true
 * /api/landing-media/lookup:
 *   get:
 *     tags: [LandingMedia]
 *     summary: Obtener configuración específica por tipo
 *     description: |
 *       Si tipo=SECCION, requiere sectionId.
 *       Si tipo=GLOBAL, requiere nombre.
 *     parameters:
 *       - in: query
 *         name: tipo
 *         required: true
 *         schema: { type: string, enum: [SECCION, GLOBAL] }
 *       - in: query
 *         name: sectionId
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: nombre
 *         required: false
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 * /api/landing-media/storage/files:
 *   get:
 *     tags: [LandingMedia]
 *     summary: Listar archivos existentes del bucket de Supabase con URL
 *     description: |
 *       Retorna archivos del bucket en forma paginada.
 *       - signed=false: retorna publicUrl (requiere bucket público para acceso directo).
 *       - signed=true: retorna signedUrl temporal (útil para bucket privado).
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 1000, default: 100 }
 *       - in: query
 *         name: prefix
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: signed
 *         required: false
 *         schema: { type: boolean, default: false }
 *       - in: query
 *         name: expiresIn
 *         required: false
 *         schema: { type: integer, minimum: 1, maximum: 604800, default: 3600 }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     bucket: { type: string }
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     prefix: { type: string }
 *                     signed: { type: boolean }
 *                     expiresIn: { type: integer, nullable: true }
 *                     total: { type: integer }
 *                     count: { type: integer }
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name: { type: string }
 *                           path: { type: string }
 *                           url: { type: string }
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [LandingMedia]
 *     summary: Eliminar imágenes/archivos del bucket de Supabase
 *     description: |
 *       Elimina uno o varios archivos por path relativo al bucket.
 *       Puedes enviar `path` (string) o `paths` (array de strings).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               path:
 *                 type: string
 *                 example: carpeta/imagen-123.webp
 *               paths:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["carpeta/imagen-1.png", "carpeta/imagen-2.webp"]
 *     responses:
 *       200:
 *         description: Eliminado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     bucket: { type: string }
 *                     deleted: { type: integer }
 *                     fileIds:
 *                       type: array
 *                       items: { type: string }
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     security: [{ bearerAuth: [] }]
 *     tags: [LandingMedia]
 *     summary: Actualizar configuración por identificación inicial
 *     description: |
 *       Para tipo=SECCION se identifica por sectionId.
 *       Para tipo=GLOBAL se identifica por nombre.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [payload]
 *             properties:
 *               payload:
 *                 type: string
 *                 description: |
 *                   JSON string con { tipo, sectionId|nombre, json }.
 *                   Para tipo=SECCION usa sectionId; para GLOBAL usa nombre.
 *               mediaFiles:
 *                 type: array
 *                 description: Archivos en campos mediaFiles[<key>]
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Actualizado
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 * /api/landing-media/{id}:
 *   get:
 *     tags: [LandingMedia]
 *     summary: Obtener configuración por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     security: [{ bearerAuth: [] }]
 *     tags: [LandingMedia]
 *     summary: Actualizar configuración por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [payload]
 *             properties:
 *               payload:
 *                 type: string
 *                 description: |
 *                   JSON string parcial con campos a actualizar.
 *                   Ejemplo: {"json":{"tripadvisorBadge":{"src":"media://tripadvisorBadge"}}}
 *               mediaFiles:
 *                 type: array
 *                 description: Archivos en campos mediaFiles[<key>]
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Actualizado
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [LandingMedia]
 *     summary: Eliminar configuración por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Eliminado
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class LandingMediaController {
  static create = async (req: Request, res: Response): Promise<void> => {
    const uploadedFileIds: string[] = [];

    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const payload = parsePayload(req);
      const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
      const filesByKey = normalizeFilesMap(files);

      const tipo = parseTipo(payload.tipo);
      const nombre = parseNombre(payload.nombre);
      const sectionId = parseSectionId(payload.sectionId);
      const json = parseJsonField(payload.json);

      const normalizedJson = await normalizeJsonMediaNodes(json, filesByKey, uploadedFileIds);

      if (filesByKey.size > 0) {
        const orphanKeys = Array.from(filesByKey.keys());
        throw Object.assign(new Error(`Hay archivos sin referencia en json: ${orphanKeys.join(", ")}`), { status: 400 });
      }

      const created = await LandingMediaService.create({ tipo, nombre, sectionId, json: normalizedJson });
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      console.error('🚨 [CONTROLLER ERROR] Error al actualizar:', error);
      if (uploadedFileIds.length > 0) {
       await Promise.allSettled(uploadedFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      if (error && typeof error === "object" && (error as { code?: unknown }).code === 11000) {
        res.status(409).json({ error: "Ya existe una configuración con ese tipo/nombre/sectionId" });
        return;
      }

      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      res.status(status).json({ error: message });
    }
  };

  static list = async (_req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const data = await LandingMediaService.getConsolidated();
      res.json(data);
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      res.status(status).json({ error: message });
    }
  };

  static listStorageFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = parsePositiveIntQuery(req.query.page, "page", 1);
      const pageSize = parsePositiveIntQuery(req.query.pageSize, "pageSize", 100);
      const signed = parseBooleanQuery(req.query.signed, false);
      const expiresIn = parsePositiveIntQuery(req.query.expiresIn, "expiresIn", 3600);
      const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";

     const data = await GcsStorageService.listFilesWithUrls({
  page,
  pageSize,
  prefix,
  signed,
  expiresIn,
});

      res.json({ success: true, data });
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      res.status(status).json({ error: message });
    }
  };

  static deleteStorageFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const fileIds = parseStorageDeletePaths(req.body);
      const data = await GcsStorageService.deleteFiles({ fileIds });

      res.json({ success: true, data });
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      res.status(status).json({ error: message });
    }
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const doc = await LandingMediaService.getById(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data: doc });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };

  static getByIdentifier = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const tipo = parseTipo(req.query.tipo);

      let doc = null;
      if (tipo === "SECCION") {
        const sectionId = parseSectionId(req.query.sectionId);
        if (!sectionId) {
          res.status(400).json({ error: "sectionId es requerido para tipo SECCION" });
          return;
        }

        doc = await LandingMediaService.getByIdentifier({ tipo: "SECCION", sectionId });
      } else {
        const nombre = parseNombre(req.query.nombre);
        doc = await LandingMediaService.getByIdentifier({ tipo: "GLOBAL", nombre });
      }

      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ [doc.nombre]: doc.json });
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      res.status(status).json({ error: message });
    }
  };

  static updateById = async (req: Request, res: Response): Promise<void> => {
    const uploadedFileIds: string[] = [];

    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const payload = parsePayload(req);
      const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
      const filesByKey = normalizeFilesMap(files);
      const idParam = typeof req.params.id === "string" ? req.params.id.trim() : "";

      const updatePayload: {
        tipo?: LandingMediaTipo;
        nombre?: string;
        sectionId?: string | null;
        json?: JsonLike;
      } = {};
      if (payload.json !== undefined) {
        
        updatePayload.json = await normalizeJsonMediaNodes(parseJsonField(payload.json), filesByKey, uploadedFileIds);
      }

      if (filesByKey.size > 0) {
        const orphanKeys = Array.from(filesByKey.keys());
        throw Object.assign(new Error(`Hay archivos sin referencia en json: ${orphanKeys.join(", ")}`), { status: 400 });
      }

      let updated = null;

      if (idParam) {
        if (payload.tipo !== undefined) updatePayload.tipo = parseTipo(payload.tipo);
        if (payload.nombre !== undefined) updatePayload.nombre = parseNombre(payload.nombre);
        if (payload.sectionId !== undefined) updatePayload.sectionId = parseSectionId(payload.sectionId);
        updated = await LandingMediaService.updateById(idParam, updatePayload);
      } else {
        const tipo = parseTipo(payload.tipo);

        if (tipo === "SECCION") {
          const sectionId = parseSectionId(payload.sectionId);
          if (!sectionId) {
            throw Object.assign(new Error("sectionId es requerido para actualizar SECCION"), { status: 400 });
          }
          updated = await LandingMediaService.updateByIdentifier({ tipo: "SECCION", sectionId }, updatePayload);
        } else {
          const nombre = parseNombre(payload.nombre);
          updated = await LandingMediaService.updateByIdentifier({ tipo: "GLOBAL", nombre }, updatePayload);
        }
      }

      if (!updated) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('🚨 [CONTROLLER ERROR] Error al actualizar:', error);
      if (uploadedFileIds.length > 0) {
      await Promise.allSettled(uploadedFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      if (error && typeof error === "object" && (error as { code?: unknown }).code === 11000) {
        res.status(409).json({ error: "Ya existe una configuración con ese tipo/nombre/sectionId" });
        return;
      }

      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
      const message = error instanceof Error ? error.message : "Error interno del servidor";
      res.status(status).json({ error: message });
    }
  };

  static deleteById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({ error: "Base de datos no conectada" });
        return;
      }

      const ok = await LandingMediaService.deleteById(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true });
    } catch (_error) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  };
}
