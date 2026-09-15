import { Router } from "express";
import { TranslateController } from "../Controllers/TranslateController";
import { authenticate } from "../middleware/auth";
import { hasRole } from "../middleware/hasRole";
import translateLimiter from "../middleware/translateLimiter";

const router = Router();

/**
 * Antes esta ruta era PÚBLICA: sin autenticación, sin rate limit y sin tope de tamaño, aceptando
 * cualquier JSON de hasta 10 MB (el límite global de `express.json`) y pasándoselo directo a
 * Gemini. Cualquiera en internet podía quemar la cuota de la API en bucle, con un costo totalmente
 * desligado del tráfico real de la web.
 *
 * Ahora exige el mismo rol que el resto de operaciones de contenido ("marketing"), más un tope por
 * IP. El tope de tamaño del payload se valida dentro del controlador.
 */
router.post("/temp", translateLimiter, authenticate, hasRole(["marketing"]), TranslateController.translateTemp);

/** Observabilidad del gasto en traducción. Mismo rol que el resto de operaciones de contenido. */
router.get("/stats", authenticate, hasRole(["marketing"]), TranslateController.stats);

export default router;
