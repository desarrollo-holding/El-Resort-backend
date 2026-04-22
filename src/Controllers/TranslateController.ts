import type { Request, Response } from "express";
import { TranslateService } from "../services/translate.service";

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
export class TranslateController {
  static translateTemp = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = req.body;

      if (!input || typeof input !== 'object') {
        res.status(400).json({ error: 'Debes enviar un objeto JSON en el body' });
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
}
