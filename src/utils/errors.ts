import type { Response } from "express";
import {
  buildErrorResponseBody,
  describeError,
  newErrorId,
  type DescribeErrorOptions,
} from "./describeError";

export type HttpError = Error & { status: number };

/** Crea un Error con un `status` HTTP adjunto, para que el controller lo mapee directo a la respuesta. */
export const toHttpError = (status: number, message: string): HttpError => {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
};

/** Extrae el `status` HTTP de un error desconocido (p. ej. uno creado por `toHttpError`), o usa el fallback. */
export const getErrorStatus = (error: unknown, fallback = 500): number => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : fallback;
};

/**
 * Única forma de contestar un error desde un controller. Clasifica la causa (ver
 * `describeError`), la escribe en el log del servidor junto a un `errorId` corto, y devuelve al
 * cliente ese mismo `errorId` con un mensaje accionable.
 *
 * `context` describe la operación, no la causa: "Error al crear el extra", "Error al subir el
 * vídeo". El motivo real lo pone `describeError`, así que el admin acaba leyendo algo como
 * «Error al crear el extra: no hay conexión con la base de datos…» en vez de un 500 mudo.
 *
 * El `errorId` es lo que hace depurable un fallo en producción: el admin lo copia del dashboard
 * y esa misma cadena aparece en los logs de Railway con la traza completa.
 */
export const sendErrorResponse = (
  res: Response,
  error: unknown,
  context: string,
  options: Omit<DescribeErrorOptions, "context"> = {}
): void => {
  const described = describeError(error, { ...options, context });
  const errorId = newErrorId();

  const logLine = `[error ${errorId}] ${described.status} ${described.code} — ${described.message}`;
  if (described.status >= 500) {
    console.error(logLine, error);
  } else {
    console.warn(logLine, described.detail ?? "");
  }

  if (res.headersSent) return;
  res.status(described.status).json(buildErrorResponseBody(described, errorId));
};
