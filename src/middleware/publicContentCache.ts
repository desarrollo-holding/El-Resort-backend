import type { Request, Response, NextFunction } from "express";

/**
 * Cabeceras de caché para los GET públicos de contenido. Antes las respuestas del API salían sin
 * ninguna directiva de caché, así que ni el navegador ni un CDN/proxy podían reutilizar una
 * respuesta en inglés ya generada: cada visitante llegaba hasta Express y, si el texto no estaba
 * traducido, hasta el traductor.
 *
 * Es una capa de defensa *adicional*, no la principal — la principal es la caché persistente de
 * traducciones (`models/TranslationCache.ts`). Acá el objetivo es que ráfagas de tráfico (una
 * campaña, un bot, un usuario recargando) no se conviertan en peticiones repetidas al origen.
 */

/** Contenido editorial: cambia solo cuando un admin guarda algo en el dashboard. */
export const CONTENT_CACHE_HEADER = "public, max-age=60, s-maxage=600, stale-while-revalidate=86400";

/**
 * Disponibilidad y tarifas de habitaciones: cambian solas (reservas entrantes, Cloudbeds). Se deja
 * `max-age=0` para que el navegador revalide siempre y el usuario nunca vea un precio viejo en su
 * propia sesión, pero se permite a un CDN compartido colapsar 60 s de tráfico en un solo hit.
 */
export const ROOMS_CACHE_HEADER = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

/** Respuestas que nunca deben quedar pegadas en una caché compartida. */
const NO_STORE = "private, no-store";

/**
 * Solo aplica a GET/HEAD anónimos y **solo a respuestas 2xx**.
 *
 * Lo de 2xx no es un detalle: la cabecera se fija antes de que corra el handler, así que sin este
 * filtro un error transitorio se quedaba cacheado. Verificado en pruebas locales: con Mongo caído,
 * `GET /api/reviews` devolvía `503` acompañado de `s-maxage=600` — es decir, un CDN habría servido
 * ese 503 a todos los visitantes durante 10 minutos aunque la base se recuperara en segundos.
 * Se envuelve `writeHead` porque es el último punto en el que todavía se pueden tocar las
 * cabeceras, cuando el status definitivo ya se conoce.
 *
 * Un request con `Authorization` es del dashboard y puede traer datos que no deben terminar en una
 * caché compartida, así que se marca explícitamente como no cacheable.
 */
export const publicContentCache = (cacheControl: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    if (req.headers.authorization) {
      res.set("Cache-Control", NO_STORE);
      next();
      return;
    }

    res.set("Cache-Control", cacheControl);

    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = function patchedWriteHead(this: Response, ...args: any[]) {
      // `res.statusCode` ya es el definitivo acá; el primer argumento de writeHead también puede
      // traerlo cuando se llama como writeHead(status, ...).
      const status = typeof args[0] === "number" ? args[0] : res.statusCode;
      if (status < 200 || status >= 300) {
        res.setHeader("Cache-Control", NO_STORE);
      }
      return (originalWriteHead as any)(...args);
    } as typeof res.writeHead;

    next();
  };
};
