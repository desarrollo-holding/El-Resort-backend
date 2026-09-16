import type { Request, Response, NextFunction } from 'express';
import { validationResult, type ValidationError } from 'express-validator';

/**
 * Nombre del campo tal y como lo entiende quien está en el dashboard. `express-validator` usa el
 * nombre técnico (`documentType`, `payload`, `mediaFiles[hero.video]`), que no dice nada.
 */
const campoLegible = (error: ValidationError): string => {
  const raw = (error as { path?: unknown; param?: unknown }).path ?? (error as { param?: unknown }).param;
  const nombre = typeof raw === 'string' ? raw.trim() : '';
  if (!nombre || nombre === '_error') return 'un campo';
  const dentroDeCorchetes = nombre.match(/\[([^\]]+)\]/);
  return `«${(dentroDeCorchetes?.[1] ?? nombre).trim()}»`;
};

/**
 * Respuesta de validación legible.
 *
 * Antes devolvía solo `{ errors: [...] }`, un array con la forma interna de express-validator que
 * el frontend no sabe leer: en pantalla salía "Request failed with status code 400" y el admin no
 * tenía forma de saber QUÉ campo estaba mal. Ahora se manda también `error` con la lista en
 * español, que es lo que el dashboard muestra, y se conserva `errors` para quien ya lo consumía.
 */
export const handleInputErrors = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const detalles = errors
      .array()
      .slice(0, 8)
      .map((error) => `${campoLegible(error)}: ${error.msg}`);

    res.status(400).json({
      error: `Hay datos inválidos en el formulario — ${detalles.join(' | ')}`,
      code: 'VALIDATION_ERROR',
      hint: 'Corrige los campos indicados y vuelve a guardar.',
      errors: errors.array(),
    });
    return;
  }

  next();
};
