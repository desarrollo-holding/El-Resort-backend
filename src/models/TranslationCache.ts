import mongoose, { Schema, Document } from "mongoose";

/**
 * Caché PERSISTENTE de traducciones, indexada por el hash del texto ORIGEN (no por el lote).
 *
 * Por qué existe: la caché anterior vivía solo en memoria del proceso y se indexaba por el hash
 * del lote completo de textos de un request. Eso la volvía inútil en los dos ejes que importan:
 *
 *  1. Por lote — el lote de `/api/rooms/show?idioma=en` depende del rango de fechas que busca el
 *     usuario (la disponibilidad filtra qué propiedades entran y en qué orden). Cada combinación
 *     de fechas producía un hash distinto, o sea un cache miss, o sea una llamada a Gemini nueva,
 *     aunque cada texto individual ya se hubiera traducido cientos de veces.
 *  2. En memoria — en Railway el contenedor se reinicia en cada deploy (y puede reciclarse solo),
 *     así que la caché arrancaba vacía una y otra vez.
 *
 * Indexando por texto origen, un texto traducido UNA vez no se vuelve a mandar a Gemini nunca:
 * ni en otro rango de fechas, ni en otro endpoint, ni después de un redeploy, ni desde otra
 * réplica si algún día se escala horizontalmente. Es content-addressed: si el admin edita el
 * texto en español, el hash cambia y se traduce el nuevo — sin necesidad de invalidación activa.
 */
export type TranslationCacheType = Document & {
  hash: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  provider: string;
  createdAt: Date;
  updatedAt: Date;
};

const TranslationCacheSchema: Schema = new Schema(
  {
    /** sha1(`${sourceLang}:${targetLang}:${sourceText}`) — ver `buildTranslationHash`. */
    hash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    /** Se guarda el original para poder auditar/depurar traducciones desde Mongo. */
    sourceText: {
      type: String,
      required: true,
    },
    translatedText: {
      type: String,
      required: true,
    },
    sourceLang: {
      type: String,
      required: true,
      default: "es",
    },
    targetLang: {
      type: String,
      required: true,
      default: "en",
    },
    /**
     * Qué motor produjo esta entrada: "gemini", "libretranslate" o "passthrough" (el traductor
     * falló y se guardó el original para no reintentar en bucle). Permite re-traducir después
     * solo lo que quedó en un motor peor, sin tocar lo bueno.
     */
    provider: {
      type: String,
      required: true,
      default: "gemini",
    },
  },
  { timestamps: true }
);

const TranslationCache = mongoose.model<TranslationCacheType>("TranslationCache", TranslationCacheSchema);

export default TranslationCache;
