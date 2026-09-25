import type { Request, Response } from "express";
import mongoose from "mongoose";
import { LANDING_MEDIA_TIPOS, type LandingMediaTipo } from "../models/LandingMedia";
import { LandingMediaService } from "../services/landingMedia.service";
import { GcsStorageService } from "../services/csStorage.service";
import { cleanupOrphanedLandingMedia } from "../services/landingMediaOrphanCleanup";
import { addMissingPdfPages, isPdfFile, keepSavedPdfPages, uploadPdfPages, type PdfPageNode } from "../services/pdfPages";

import { sendErrorResponse } from "../utils/errors";
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

/** Exportada solo para test: normaliza cada nodo `{ src }` del árbol de medios de una sección. */
export const normalizeJsonMediaNodes = async (
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
    // Solo se llena en una subida fresca (media://): un `src` que ya era URL directa no
    // vuelve a pasar por el pipeline, así que conserva el `width`/`height`/`variants` que
    // ya tuviera guardados (o nada, si nunca los tuvo).
    let freshImageMeta: { width?: number; height?: number; variants: unknown[] } | undefined;
    // Un PDF recién subido (la carta de AUCA) se guarda también como una imagen por página: ver
    // services/pdfPages.ts. Un PDF que ya estaba guardado conserva las `pages` que traiga el nodo.
    let freshPdfPages: PdfPageNode[] | undefined;
    let wasFreshUpload = false;
    /**
     * Ranura declarada pero vacia: el admin todavia no subio nada, o quito lo que habia. No es
     * un error -- se guarda el hueco (`src: ""`, `status: "missing"`) y el front lo lee como
     * "sin medio" y no pinta nada (p. ej. los decorativos de esquina, que son opcionales por
     * seccion). Antes esto caia en el `else` de abajo y respondia 400 `src invalido:`.
     */
    const isEmptySlot = normalizedSrcInput.length === 0;

    if (isEmptySlot) {
      finalSrc = "";
    } else if (isMediaRef(normalizedSrcInput)) {
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
      // El `mimetype` real del archivo ya se conoce acá (antes de subir): usarlo es lo que
      // hace que `requestedKind` sea "image" de forma confiable. Sin esto, un nodo nuevo
      // (sin `kind` todavía en el payload) caía a "file" -- carpeta `files/` y sin pasar por
      // el optimizador -- aunque el archivo fuera claramente una imagen.
      const requestedKind = detectMediaKind({ src: normalizedSrcInput, mimeType: file.mimetype, currentKind: value.kind });

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
      wasFreshUpload = true;
      // `uploaded.width` solo viene poblado para imágenes rasterizables (no SVG/GIF/video):
      // ver GcsStorageService.uploadFile. Con escalera de variantes, listo para `srcset`.
      if (requestedKind === "image" && uploaded.width !== undefined) {
        freshImageMeta = { width: uploaded.width, height: uploaded.height, variants: uploaded.variants ?? [] };
      }
      if (requestedKind === "file" && isPdfFile(file.originalname, file.mimetype)) {
        const converted = await uploadPdfPages(file.buffer, file.originalname);
        // A la lista de rollback: si algo falla más adelante en este guardado, se borran junto al PDF.
        uploadedFileIds.push(...converted.fileIds);
        freshPdfPages = converted.pages;
      }
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
      // Con `src` vacio no hay extension ni mimetype que mirar: `detectMediaKind` cae al `kind`
      // que ya traia el nodo, que es justo lo que declara la ranura (`image`, `video`).
      kind: detectMediaKind({ src: finalSrc, mimeType: mimeTypeForKind, currentKind: value.kind }),
      status: isEmptySlot ? "missing" : "existing",
    };

    if (freshImageMeta) {
      normalizedMediaNode.width = freshImageMeta.width;
      normalizedMediaNode.height = freshImageMeta.height;
      normalizedMediaNode.variants = freshImageMeta.variants;
    } else if (wasFreshUpload || isEmptySlot) {
      // Se reemplazó el archivo por uno que no genera variantes (video, SVG, GIF) o se vació la
      // ranura: la metadata de la versión anterior ya no aplica.
      delete normalizedMediaNode.width;
      delete normalizedMediaNode.height;
      delete normalizedMediaNode.variants;
    }
    // Las páginas son del PDF anterior: al reemplazarlo o vaciar la ranura dejan de valer, y al
    // faltar en el árbol `cleanupOrphanedLandingMedia` las borra del bucket.
    if (wasFreshUpload || isEmptySlot) delete normalizedMediaNode.pages;
    if (freshPdfPages) normalizedMediaNode.pages = freshPdfPages;

    for (const [k, v] of Object.entries(normalizedMediaNode)) {
      if (k === "src" || k === "kind" || k === "status" || k === "width" || k === "height" || k === "variants") continue;
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
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
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

      sendErrorResponse(res, error, "Error al crear los medios del landing");
    }
  };

  static list = async (_req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const data = await LandingMediaService.getConsolidated();
      res.json(data);
    } catch (error) {
      sendErrorResponse(res, error, "Error al obtener los medios del landing");
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
      sendErrorResponse(res, error, "Error al listar los archivos del almacén");
    }
  };

  static deleteStorageFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const fileIds = parseStorageDeletePaths(req.body);
      const data = await GcsStorageService.deleteFiles({ fileIds });

      res.json({ success: true, data });
    } catch (error) {
      sendErrorResponse(res, error, "Error al eliminar archivos del almacén");
    }
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const doc = await LandingMediaService.getById(req.params.id);
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data: doc });
    } catch (error) {
      sendErrorResponse(res, error, "Error al obtener el medio del landing");
    }
  };

  static getByIdentifier = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
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
      sendErrorResponse(res, error, "Error al obtener los medios de la sección");
    }
  };

  static updateById = async (req: Request, res: Response): Promise<void> => {
    const uploadedFileIds: string[] = [];

    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const payload = parsePayload(req);
      const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
      const filesByKey = normalizeFilesMap(files);
      const idParam = typeof req.params.id === "string" ? req.params.id.trim() : "";

      // Se resuelve el documento existente (si lo hay) ANTES de subir nada: es la fuente para
      // saber, después de guardar, qué imágenes salieron del árbol y hay que borrar del
      // storage (`cleanupOrphanedLandingMedia`). tipo/sectionId/nombre ya parseados acá se
      // reutilizan más abajo para el update real, no se vuelven a parsear.
      let existingJson: unknown;
      let resolvedTipo: LandingMediaTipo | undefined;
      let resolvedSectionId: string | undefined;
      let resolvedNombre: string | undefined;

      if (idParam) {
        const existing = await LandingMediaService.getById(idParam);
        existingJson = existing?.json;
      } else {
        resolvedTipo = parseTipo(payload.tipo);
        if (resolvedTipo === "SECCION") {
          const sectionId = parseSectionId(payload.sectionId);
          if (!sectionId) {
            throw Object.assign(new Error("sectionId es requerido para actualizar SECCION"), { status: 400 });
          }
          resolvedSectionId = sectionId;
          const existing = await LandingMediaService.getByIdentifier({ tipo: "SECCION", sectionId });
          existingJson = existing?.json;
        } else {
          resolvedNombre = parseNombre(payload.nombre);
          const existing = await LandingMediaService.getByIdentifier({ tipo: "GLOBAL", nombre: resolvedNombre });
          existingJson = existing?.json;
        }
      }

      const updatePayload: {
        tipo?: LandingMediaTipo;
        nombre?: string;
        sectionId?: string | null;
        json?: JsonLike;
      } = {};
      if (payload.json !== undefined) {

        updatePayload.json = await normalizeJsonMediaNodes(parseJsonField(payload.json), filesByKey, uploadedFileIds);
        // Páginas de los PDF (services/pdfPages.ts): primero se recuperan las que un panel
        // desactualizado no mandó, y solo después se convierte lo que de verdad no tenga.
        if (existingJson !== undefined) keepSavedPdfPages(existingJson, updatePayload.json);
        await addMissingPdfPages(updatePayload.json, uploadedFileIds);
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
      } else if (resolvedTipo === "SECCION") {
        updated = await LandingMediaService.updateByIdentifier({ tipo: "SECCION", sectionId: resolvedSectionId! }, updatePayload);
        if (!updated) {
          // Primer guardado de medios para esta sección: todavía no existe el documento
          // (p. ej. una sección que hasta ahora solo tenía textos). Se crea en vez de 404.
          const nombre = parseNombre(payload.nombre);
          updated = await LandingMediaService.create({
            tipo: "SECCION",
            nombre,
            sectionId: resolvedSectionId!,
            json: updatePayload.json ?? {},
          });
        }
      } else {
        updated = await LandingMediaService.updateByIdentifier({ tipo: "GLOBAL", nombre: resolvedNombre! }, updatePayload);
        if (!updated) {
          updated = await LandingMediaService.create({
            tipo: "GLOBAL",
            nombre: resolvedNombre!,
            sectionId: null,
            json: updatePayload.json ?? {},
          });
        }
      }

      if (!updated) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      // Limpieza de huérfanos: recién que el guardado en Mongo ya se confirmó (nunca antes),
      // se borran del storage las imágenes que salieron del árbol (reemplazadas o quitadas).
      // Solo aplica si el body tocó `json` y si ya existía un documento antes de este guardado.
      if (payload.json !== undefined && existingJson !== undefined) {
        await cleanupOrphanedLandingMedia(existingJson, updated.json);
      }

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('🚨 [CONTROLLER ERROR] Error al actualizar:', error);
      if (uploadedFileIds.length > 0) {
      await Promise.allSettled(uploadedFileIds.map((fileId) => GcsStorageService.deleteFile({ fileId })));
      }

      sendErrorResponse(res, error, "Error al guardar los medios del landing");
    }
  };

  static deleteById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      // Se lee el documento antes de borrarlo: sin esto, cada imagen que tuviera (hero,
      // badges, carousel...) quedaría huérfana en el storage para siempre.
      const existing = await LandingMediaService.getById(req.params.id);
      const ok = await LandingMediaService.deleteById(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      if (existing) {
        await cleanupOrphanedLandingMedia(existing.json, null);
      }

      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, error, "Error al eliminar el medio del landing");
    }
  };
}
