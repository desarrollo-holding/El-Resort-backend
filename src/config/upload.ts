import multer from "multer";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Los límites de subida vigentes en la ruta por la que entró la petición. El manejador de errores
 * los lee para poder decir el máximo EXACTO ("supera el máximo de 20 MB") en lugar de un genérico
 * "archivo demasiado grande": multer no adjunta el límite al error que lanza, solo el nombre del
 * campo, y sin esto el admin no sabe a qué tamaño tiene que bajar el vídeo.
 */
export type UploadLimits = { fileSizeBytes: number; filesLimit: number };

declare global {
  namespace Express {
    interface Request {
      uploadLimits?: UploadLimits;
    }
  }
}

export const defaultMaxUploadFileSizeBytes = (() => {
  const envBytes = process.env.MAX_UPLOAD_FILE_SIZE_BYTES;
  const envMb = process.env.MAX_UPLOAD_FILE_SIZE_MB;
  if (envBytes && !Number.isNaN(Number(envBytes))) return Number(envBytes);
  if (envMb && !Number.isNaN(Number(envMb))) return Math.round(Number(envMb) * 1024 * 1024);
  return 20 * 1024 * 1024; // default 20 MB per file
})();

/** Mismo valor que usaban los callers antes de nombrar la constante. */
const defaultFileSizeBytes = defaultMaxUploadFileSizeBytes;

type UploadMiddlewareFactory = {
  single: (field: string) => RequestHandler[];
  array: (field: string, maxCount?: number) => RequestHandler[];
  fields: (fields: readonly multer.Field[]) => RequestHandler[];
  any: () => RequestHandler[];
  none: () => RequestHandler[];
  limits: UploadLimits;
};

export const createMemoryUpload = (
  filesLimit = 10,
  fileSizeBytes = defaultFileSizeBytes
): UploadMiddlewareFactory => {
  const limits: UploadLimits = { fileSizeBytes, filesLimit };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: filesLimit, fileSize: fileSizeBytes },
  });

  // Se ejecuta ANTES que multer para que el límite esté en `req` aunque multer aborte la subida.
  const tagLimits: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
    req.uploadLimits = limits;
    next();
  };

  const withTag = (handler: RequestHandler): RequestHandler[] => [tagLimits, handler];

  return {
    single: (field) => withTag(upload.single(field)),
    array: (field, maxCount) => withTag(upload.array(field, maxCount)),
    fields: (fields) => withTag(upload.fields(fields as multer.Field[])),
    any: () => withTag(upload.any()),
    none: () => withTag(upload.none()),
    limits,
  };
};

export default createMemoryUpload;
