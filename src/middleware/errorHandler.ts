import type { NextFunction, Request, Response } from "express";
import {
  buildErrorResponseBody,
  describeError,
  newErrorId,
} from "../utils/describeError";

/**
 * Último middleware de la app: todo error que no atrape un controller termina aquí.
 *
 * Sin él, Express usa su manejador por defecto, que responde HTML con un 500 y sin pista alguna.
 * Ese era exactamente el caso del vídeo demasiado pesado: multer aborta la subida ANTES de que el
 * controller se ejecute, así que ningún `try/catch` de `LandingMediaController` podía verlo y el
 * dashboard solo recibía "Request failed with status code 500".
 *
 * Aquí, en cambio, el error se clasifica (`describeError`), se registra con un `errorId` y se
 * devuelve como JSON con mensaje, pista de qué revisar y ese mismo id para buscar en los logs.
 */
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const described = describeError(err, { uploadLimits: req.uploadLimits });
  const errorId = newErrorId();

  const quien = req.user?.email ? ` usuario=${req.user.email}` : "";
  const logLine = `[error ${errorId}] ${req.method} ${req.originalUrl} -> ${described.status} ${described.code} — ${described.message}${quien}`;

  if (described.status >= 500) {
    console.error(logLine, err);
  } else {
    console.warn(logLine, described.detail ?? "");
  }

  res.status(described.status).json(buildErrorResponseBody(described, errorId));
};

/**
 * Ruta de API inexistente. Sin esto Express responde una página HTML de 404 que el frontend no
 * sabe leer, y un endpoint mal escrito parece "el servidor no responde".
 */
export const apiNotFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    error: `La ruta ${req.method} ${req.originalUrl} no existe en el API.`,
    code: "ROUTE_NOT_FOUND",
    hint: "Revisa la URL y el método. Si el frontend acaba de cambiar, comprueba que el backend desplegado tenga esa ruta (src/app.ts).",
    errorId: newErrorId(),
  });
};

export default errorHandler;
