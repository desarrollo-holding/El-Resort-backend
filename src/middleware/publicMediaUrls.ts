import type { NextFunction, Request, Response } from "express";
import { isPublicMediaRewriteEnabled, rewriteMediaUrlsInJson } from "../services/publicMedia";

/**
 * Envuelve `res.json` para que TODA respuesta JSON salga con las URLs de medios reescritas al
 * origen público (ver services/publicMedia.ts para el por qué).
 *
 * Se monta una sola vez, antes de las rutas: es el único punto por el que pasan todas las
 * respuestas, así que no hay controlador que se pueda olvidar. La alternativa —reescribir en cada
 * servicio— es la que garantiza que el día que alguien agregue un endpoint nuevo, sus imágenes
 * salgan por el bucket y nadie se entere, porque el sitio funciona igual, solo más lento.
 *
 * Replica lo que hace `res.json` de Express (serializar con los ajustes `json replacer` /
 * `json spaces` / `json escape` de la app y enviar con `Content-Type: application/json`) porque
 * necesita el texto serializado en la mano para reescribirlo. Si la reescritura está apagada
 * —`MEDIA_PUBLIC_BASE_URL` sin definir, que es el rollback— delega en el `res.json` original y no
 * agrega ni una operación.
 */
export function publicMediaUrls(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function patchedJson(payload: unknown) {
    if (!isPublicMediaRewriteEnabled()) return originalJson(payload);

    const app = req.app;
    const replacer = app.get("json replacer") as Parameters<typeof JSON.stringify>[1];
    const spaces = app.get("json spaces") as Parameters<typeof JSON.stringify>[2];

    let body: string;
    try {
      body = JSON.stringify(payload, replacer, spaces);
    } catch {
      // Un payload que no se puede serializar (una referencia circular) fallaría igual dentro de
      // `res.json`. Se delega para que el error y su stack sean los de Express, no los de acá.
      return originalJson(payload);
    }

    // `JSON.stringify(undefined)` devuelve undefined: `res.json()` sin argumentos es válido en
    // Express y responde un cuerpo vacío.
    if (body === undefined) return originalJson(payload);

    if (app.get("json escape")) {
      // Mismo escapado que Express: evita que `<`, `>` y `&` salgan literales en un cuerpo JSON
      // que algún cliente pudiera interpretar como HTML.
      body = body.replace(/[<>&]/g, (char) =>
        char === "<" ? "\\u003c" : char === ">" ? "\\u003e" : "\\u0026"
      );
    }

    body = rewriteMediaUrlsInJson(body);

    if (!res.get("Content-Type")) res.set("Content-Type", "application/json; charset=utf-8");
    return res.send(body);
  };

  next();
}

export default publicMediaUrls;
