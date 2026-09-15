import type { Request, Response } from "express";
import mongoose from "mongoose";
import { TranslateService } from "../services/translate.service";
import TranslationCache from "../models/TranslationCache";

/**
 * @openapi
 * /api/translate/temp:
 *   post:
 *     tags: [Translate]
 *     summary: Traduce los valores de un objeto JSON a inglés usando Gemini
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Traduccion generada correctamente
 *       400:
 *         description: Body invalido
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       500:
 *         description: Error interno
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
/**
 * Tope de tamaño del objeto a traducir. `express.json` permite hasta 10 MB globalmente, que para
 * esta ruta es absurdo: cada byte que entra acá se convierte en tokens facturados por Gemini.
 * 50 KB cubre de sobra la sección de landing más grande.
 */
const MAX_TRANSLATE_PAYLOAD_BYTES = 50_000;

export class TranslateController {
  static translateTemp = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = req.body;

      if (!input || typeof input !== 'object') {
        res.status(400).json({ error: 'Debes enviar un objeto JSON en el body' });
        return;
      }

      const payloadBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
      if (payloadBytes > MAX_TRANSLATE_PAYLOAD_BYTES) {
        res.status(413).json({
          error: `El objeto a traducir supera el limite de ${MAX_TRANSLATE_PAYLOAD_BYTES} bytes (recibido: ${payloadBytes}).`,
        });
        return;
      }

      const translated = await TranslateService.translateJsonObject(input);
      res.json(translated);
    } catch (error) {
      const anyError = error as any;
      const status = typeof anyError?.status === 'number' ? anyError.status : 500;
      const message = error instanceof Error ? error.message : 'Error interno del servidor';
      res.status(status).json({ error: message });
    }
  };

  /**
   * GET /api/translate/stats — cuánto se está usando realmente el traductor.
   *
   * `TranslationCache.countDocuments` agrupado por `provider` es el contador ACUMULADO real: vive
   * en Mongo, así que sobrevive a los redeploys de Railway. La regla para vigilar el lanzamiento
   * es simple: si `totalCacheados` crece cuando nadie editó contenido, hay una fuga. Los
   * contadores en memoria se reinician con el proceso y sirven para ver la sesión actual.
   */
  static stats = async (_req: Request, res: Response): Promise<void> => {
    const metrics = TranslateService.getMetrics();

    let porProveedor: Record<string, number> = {};
    let totalCacheados = 0;
    if (mongoose.connection.readyState === 1) {
      try {
        const rows = await TranslationCache.aggregate([
          { $group: { _id: "$provider", n: { $sum: 1 } } },
        ]);
        for (const row of rows) {
          porProveedor[String(row._id)] = row.n;
          totalCacheados += row.n;
        }
      } catch (error) {
        console.error("[TranslateController.stats]", error);
      }
    }

    res.json({
      success: true,
      data: {
        procesoActual: metrics,
        cachePersistente: { totalCacheados, porProveedor },
      },
    });
  };
}
