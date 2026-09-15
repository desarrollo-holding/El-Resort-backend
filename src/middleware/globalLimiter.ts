import rateLimit from "express-rate-limit";

/**
 * Techo global por IP para toda la API. No sustituye a los límites específicos (login, reclamos,
 * traducción manual): es una red por debajo de ellos.
 *
 * El número es deliberadamente holgado — una carga de la landing dispara del orden de 10 peticiones
 * y un usuario navegando rápido puede encadenar varias — pero corta en seco a un bot que intente
 * machacar los endpoints públicos de contenido, que son los que con la caché fría pueden acabar
 * llamando al traductor.
 *
 * Depende de `app.set("trust proxy", 1)` en app.ts: sin eso la clave sería la IP del proxy de
 * Railway y el límite se aplicaría a todos los visitantes en conjunto.
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

export default globalLimiter;
