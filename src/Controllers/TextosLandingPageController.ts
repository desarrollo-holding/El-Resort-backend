import type { Request, Response } from "express";
import mongoose from "mongoose";
import { TextosLandingPageService } from "../services/textosLandingPage.service";
import { TranslateService } from "../services/translate.service";
import { TranslationSanitizer } from "../services/translationSanitizer.service";

import { sendErrorResponse } from "../utils/errors";
const isMongoDuplicateKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === 11000;
};

/**
 * @openapi
 * /api/textos-landing-page:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [TextosLandingPage]
 *     summary: Crear texto de landing por idioma y sectionId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idioma, section, json]
 *             properties:
 *               idioma: { type: string, example: es }
 *               section: { type: string, example: 67fbe2b9f95aab97d58f4c2a, description: ID de LandingPageSection }
 *               json: { type: object, additionalProperties: true }
 *     responses:
 *       201: { description: Creado }
 *       409:
 *         description: Ya existe la combinación idioma + section
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 *   get:
 *     tags: [TextosLandingPage]
 *     summary: Obtener todos los sections por idioma
 *     parameters:
 *       - in: query
 *         name: idioma
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Objeto plano section -> json
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *             example:
 *               hero:
 *                 title: Bienvenido
 *               faq:
 *                 title: Preguntas frecuentes
 *
 * /api/textos-landing-page/section/{sectionId}/es:
 *   get:
 *     tags: [TextosLandingPage]
 *     summary: Obtener texto en idioma es por sectionId
 *     parameters:
 *       - in: path
 *         name: sectionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Registro encontrado
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 * /api/textos-landing-page/section/{sectionId}/translate-en:
 *   post:
 *     security: [{ bearerAuth: [] }]
 *     tags: [TextosLandingPage]
 *     summary: Traduce el json de la sección desde es y crea registro en en
 *     parameters:
 *       - in: path
 *         name: sectionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Registro en idioma en creado correctamente
 *       404:
 *         description: No existe registro es para la sección
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Ya existe registro en para la sección
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *
 * /api/textos-landing-page/{id}:
 *   get:
 *     tags: [TextosLandingPage]
 *     summary: Obtener registro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     security: [{ bearerAuth: [] }]
 *     tags: [TextosLandingPage]
 *     summary: Actualizar parcialmente json de un registro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               json:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Patch parcial de campos dentro de json (no reemplaza todo el objeto)
 *     responses:
 *       200: { description: OK }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     security: [{ bearerAuth: [] }]
 *     tags: [TextosLandingPage]
 *     summary: Eliminar registro por id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404:
 *         description: No encontrado
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export class TextosLandingPageController {
  private static translateSectionToEnglishCore = async (sectionId: string, res: Response): Promise<void> => {
    const sourceEs = await TextosLandingPageService.getBySectionAndIdioma(sectionId, "es");
    if (!sourceEs) {
      res.status(404).json({ error: "No existe registro en idioma 'es' para ese sectionId" });
      return;
    }

    const existingEn = await TextosLandingPageService.getBySectionAndIdioma(sectionId, "en");
    if (existingEn) {
      res.status(409).json({ error: "Ya existe registro en idioma 'en' para ese sectionId" });
      return;
    }

    if (!sourceEs.json || typeof sourceEs.json !== "object" || Array.isArray(sourceEs.json)) {
      res.status(400).json({ error: "El campo json en 'es' debe ser un objeto JSON para traducir" });
      return;
    }

    const rawJson = await TranslateService.translateJsonObject(sourceEs.json as object);
    // Ver `dropDegenerateTranslations`: una clave que vuelve como `"_"` o vacía se descarta, para
    // que el front caiga a su copia de respaldo en inglés en vez de quedarse con basura guardada.
    const translatedJson = TranslationSanitizer.dropDegenerateTranslations(sourceEs.json, rawJson);
    if (translatedJson === undefined) {
      res.status(502).json({ error: "El traductor no devolvió un texto usable para esta sección" });
      return;
    }
    const created = await TextosLandingPageService.create("en", sectionId, translatedJson);
    res.status(201).json({ success: true, data: created });
  };

  static create = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const { idioma, section, json } = req.body as { idioma: string; section: string; json: unknown };
      const created = await TextosLandingPageService.create(idioma.trim(), section.trim(), json);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        res.status(409).json({ error: "Ya existe un registro para esa combinacion idioma + sectionId" });
        return;
      }
      sendErrorResponse(res, error, "Error al crear el texto del landing");
    }
  };

  static getById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const { id } = req.params;
      const doc = await TextosLandingPageService.getById(id);
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }
      res.json({ success: true, data: doc });
    } catch (error) {
      sendErrorResponse(res, error, "Error al obtener el texto del landing");
    }
  };

  static list = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const idioma = typeof req.query.idioma === "string" ? req.query.idioma.trim() : "";
      const data = await TextosLandingPageService.getAllSectionsByIdioma(idioma);
      if (idioma.toLowerCase() === "en") {
        await TextosLandingPageController.fillMissingEnglishSections(data);
      }
      res.json(data);
    } catch (error) {
      sendErrorResponse(res, error, "Error al obtener los textos del landing");
    }
  };

  /**
   * Respaldo de lectura para las secciones que existen en español pero no en inglés.
   *
   * Hasta acá, esas secciones simplemente no salían en la respuesta de `?idioma=en`. El front no
   * se rompe -cae a su copia de respaldo `src/assets/i18n/en.json`-, pero esa copia es una foto
   * congelada del texto por defecto: lo que el admin escribe en el dashboard NO se ve nunca en
   * inglés, y encima el síntoma es silencioso (no hay error, solo texto viejo). Le pasaba a
   * `roomDetailsDiscoverSection` y a `reviewsSection`, creadas antes de que el PATCH sincronizara
   * el inglés solo.
   *
   * Se traduce con el mismo `TranslateService` que usa el guardado (Gemini con LibreTranslate de
   * respaldo) y se PERSISTE: el costo es único por sección, porque a partir de ahí ya existe el
   * registro `en` y esta función no vuelve a encontrarla.
   *
   * Si ningún motor pudo traducir, `translateJsonObject` devuelve el MISMO objeto que recibió. En
   * ese caso la sección se omite a propósito, igual que antes: mandar el español pisaría la copia
   * de respaldo en inglés del front, que se ve mejor que el texto sin traducir.
   */
  private static fillMissingEnglishSections = async (
    response: Record<string, unknown>
  ): Promise<void> => {
    let missing: Array<{ sectionId: string; sectionName: string; json: unknown }> = [];
    try {
      missing = await TextosLandingPageService.getSectionsMissingForIdioma("en");
    } catch (error) {
      console.error("[TextosLandingPage] No se pudieron buscar las secciones sin inglés:", error);
      return;
    }

    for (const section of missing) {
      const source = section.json;
      if (!source || typeof source !== "object" || Array.isArray(source)) continue;

      try {
        const raw = await TranslateService.translateJsonObject(source as object);
        // Se descartan las claves que volvieron inservibles (p. ej. «DESCUBRE EL RESORT» → `"_"`):
        // persistirlas sería peor que no traducir, porque a partir de ahí ganan sobre la copia de
        // respaldo del front, que para esas claves sí tiene el texto correcto.
        const translated = TranslationSanitizer.dropDegenerateTranslations(source, raw);
        if (raw === source || translated === undefined) {
          console.warn(
            `[TextosLandingPage] Ningún motor tradujo "${section.sectionName}": se omite y el front usa su copia de respaldo.`
          );
          continue;
        }

        response[section.sectionName] = translated;
        await TextosLandingPageService.upsertBySectionAndIdioma(section.sectionId, "en", translated);
      } catch (error) {
        // Nunca tumbar la respuesta entera por una sección: el resto del landing sí se pudo servir.
        console.error(
          `[TextosLandingPage] Falló el respaldo de traducción de "${section.sectionName}":`,
          error
        );
      }
    }
  };

  static getSpanishBySectionId = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const { sectionId } = req.params;
      const doc = await TextosLandingPageService.getSpanishBySectionId(sectionId);
      if (!doc) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true, data: doc });
    } catch (error) {
      sendErrorResponse(res, error, "Error al obtener los textos en español de la sección");
    }
  };

  static translateSectionToEnglish = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const { sectionId } = req.params;
      await TextosLandingPageController.translateSectionToEnglishCore(sectionId, res);
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        res.status(409).json({ error: "Ya existe un registro para esa combinacion idioma + sectionId" });
        return;
      }

      sendErrorResponse(res, error, "Error al traducir la sección al inglés");
    }
  };

  static updateById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const { id } = req.params;
      const { json } = req.body as { json?: unknown };

      const updated = await TextosLandingPageService.updateById(id, {
        json,
      });

      if (!updated) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      // Auto-sync: si se actualiza 'es', intentamos refrescar 'en' con Gemini.
      // Si Gemini falla, NO tocamos el registro en inglés (queda con la traducción anterior)
      // y avisamos al admin vía `enSyncWarning` en vez de fallar en silencio: sin esto, el
      // texto en inglés puede quedar desactualizado indefinidamente sin que nadie lo note.
      let enSyncWarning: string | undefined;
      if (updated.idioma === "es" && updated.json && typeof updated.json === "object" && !Array.isArray(updated.json)) {
        try {
          const rawEnJson = await TranslateService.translateJsonObject(updated.json as object);
          // Mismo criterio que en el respaldo de lectura: lo que vuelve inservible no se guarda.
          const translatedEnJson = TranslationSanitizer.dropDegenerateTranslations(updated.json, rawEnJson);
          if (translatedEnJson === undefined) {
            throw new Error("el traductor no devolvió un texto usable");
          }
          await TextosLandingPageService.upsertBySectionAndIdioma(updated.section, "en", translatedEnJson);
        } catch (geminiError) {
          const message = geminiError instanceof Error ? geminiError.message : String(geminiError);
          console.error(
            `[TextosLandingPageController.updateById] Fallo la sincronización automática a inglés para section=${updated.section}; EN quedó sin actualizar:`,
            message
          );
          enSyncWarning = `Se guardó en español, pero no se pudo sincronizar automáticamente al inglés: ${message}`;
        }
      }

      res.json({ success: true, data: updated, ...(enSyncWarning ? { enSyncWarning } : {}) });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        res.status(409).json({ error: "Ya existe un registro para esa combinacion idioma + sectionId" });
        return;
      }

      sendErrorResponse(res, error, "Error al actualizar el texto del landing");
    }
  };

  static deleteById = async (req: Request, res: Response): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) {
        res.status(503).json({
          error: "No hay conexión con la base de datos: el servidor está arriba pero no puede leer ni guardar nada.",
          code: "DATABASE_UNAVAILABLE",
          hint: "Revisa DATABASE_URL en las variables del servidor, que el cluster de MongoDB Atlas esté encendido, y que la IP del servidor siga permitida en Network Access de Atlas.",
        });
        return;
      }

      const { id } = req.params;
      const ok = await TextosLandingPageService.deleteById(id);
      if (!ok) {
        res.status(404).json({ error: "No encontrado" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      sendErrorResponse(res, error, "Error al eliminar el texto del landing");
    }
  };
}