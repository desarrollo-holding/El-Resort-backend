import rateLimit from "express-rate-limit";

/**
 * Tope de peticiones para la ruta de traducción manual. Es una ruta que le cuesta dinero real a
 * cada llamada (cuota de Gemini), así que el límite es deliberadamente bajo: la usa un admin desde
 * el dashboard de forma puntual, no un flujo automático.
 */
const translateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // Máximo 10 traducciones manuales por IP por minuto
  message: { error: "Demasiadas solicitudes de traducción. Intenta de nuevo en un minuto." },
  standardHeaders: true,
  legacyHeaders: false,
});

export default translateLimiter;
