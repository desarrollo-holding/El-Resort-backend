import { TranslateService } from "./translate.service";
import { TranslationSanitizer } from "./translationSanitizer.service";
import { resolveAmenityLabel, type AmenityLocale } from "./roomAmenityGlossary";

type JsonRecord = Record<string, unknown>;

type BedroomLike = { description?: unknown };

type HasPresentation = { presentation?: unknown };

type PresentationLike = { roomTypeName?: unknown; roomTypeDescription?: unknown };

type HasBedrooms = { bedrooms?: unknown };

type PayloadWithData = { data?: unknown };

/**
 * Inglés ya persistido por propiedad (ver `RoomTypeLocalTextService`/`updateByRoomTypeID`).
 * Si existe para un campo, se usa tal cual y se salta la llamada en vivo a LibreTranslate para
 * ese campo — evita re-traducir en cada request y evita traducir un texto que ya está en inglés.
 * Sin entrada (o `nameEn`/`descriptionEn` vacíos), el comportamiento no cambia respecto a antes:
 * `roomTypeDescription` cae al traductor en vivo; `roomTypeName` nunca se tradujo y sigue sin
 * traducirse (no había esa capacidad antes de que el nombre fuera administrable localmente).
 */
export type LocalEnByRoomTypeID = Map<string, { nameEn?: string | null; descriptionEn?: string | null }>;

const isObjectRecord = (value: unknown): value is JsonRecord => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Los payloads que pasan por acá son casi siempre resultado de `.lean()` sobre un modelo de
 * Mongoose: se ven como objetos planos, pero campos como `_id` (o `condominioID`, cuando no se
 * normalizó antes) siguen siendo instancias de `ObjectId` de BSON, no strings. `res.json()` los
 * serializa bien porque `JSON.stringify` invoca su `toJSON()` (devuelve el hex de 24 caracteres).
 *
 * `structuredClone` NO invoca `toJSON()` — no es su contrato, clona la instancia campo a campo — y
 * el resultado deja de ser un `ObjectId`: termina viajando como `{ buffer: { "0": 105, ... } }` en
 * vez de la cadena hex. El schema de Zod del frontend (`_id: z.string()`) rechazaba esa forma, y
 * como la traducción es la ÚNICA rama que pasa por `deepClone`, esto rompía la respuesta completa
 * -incluido el vídeo de la propiedad- SOLO en inglés, nunca en español (que no clona nada, manda
 * el documento de Mongoose tal cual a `res.json()`).
 *
 * `JSON.parse(JSON.stringify(...))` no tiene este problema: es la MISMA serialización que hará
 * `res.json()` al final, así que el clon ya sale con los `ObjectId`/`Date`/`Decimal128` convertidos
 * exactamente como se van a mandar — no una aproximación que hay que confiar en que coincida.
 */
const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const getRoomTypeID = (item: unknown): string | undefined => {
  const raw = (item as { roomTypeID?: unknown } | null)?.roomTypeID;
  return typeof raw === "string" ? raw : undefined;
};

const collectRoomTypeDescriptions = (
  data: unknown,
  texts: string[],
  setters: Array<(translated: string) => void>,
  localEnByRoomTypeID?: LocalEnByRoomTypeID
) => {
  if (!Array.isArray(data)) return;

  for (const item of data) {
    if (!isObjectRecord(item)) continue;

    const presentation = (item as HasPresentation).presentation;
    if (!isObjectRecord(presentation)) continue;

    const localEn = localEnByRoomTypeID?.get(getRoomTypeID(item) ?? "");

    const roomTypeName = (presentation as PresentationLike).roomTypeName;
    const nameEn = localEn?.nameEn?.trim();
    if (typeof roomTypeName === "string" && nameEn) {
      (presentation as any).roomTypeName = TranslationSanitizer.sanitizeTranslatedText(nameEn);
    }

    const roomTypeDescription = (presentation as PresentationLike).roomTypeDescription;
    const descriptionEn = localEn?.descriptionEn?.trim();
    if (typeof roomTypeDescription === "string" && roomTypeDescription.trim()) {
      if (descriptionEn) {
        (presentation as any).roomTypeDescription = TranslationSanitizer.sanitizeTranslatedText(descriptionEn);
      } else {
        texts.push(roomTypeDescription);
        setters.push((translated) => {
          (presentation as any).roomTypeDescription = translated;
        });
      }
    }
  }
};

/**
 * Deja `roomTypeFeatures` (las comodidades que la ficha pinta como «beneficios incluidos») en el
 * idioma pedido. `container` es el objeto que las lleva: en `/api/rooms/show` es
 * `item.presentation`; en `/api/rooms/show/{id}` es el propio `data`.
 *
 * El catálogo de CloudBeds mezcla los dos idiomas, así que esto corre para AMBOS: no es solo
 * «traducir al inglés», es normalizar al idioma que se pidió. Primero manda el glosario curado
 * (roomAmenityGlossary.ts) y, si se pasó `queue` (solo en la rama en inglés), lo que no esté en el
 * glosario cae al traductor automático como respaldo.
 *
 * Se deduplica por la etiqueta ya resuelta: comodidades que en el catálogo son dos filas distintas
 * pueden colapsar en una sola al normalizarlas (p. ej. «Televisor» y «TV»), y sin esto la ficha las
 * mostraría repetidas.
 */
const localizeFeatures = (
  container: unknown,
  target: AmenityLocale,
  queue?: { texts: string[]; setters: Array<(translated: string) => void> }
) => {
  if (!isObjectRecord(container)) return;

  const features = (container as { roomTypeFeatures?: unknown }).roomTypeFeatures;
  if (!Array.isArray(features)) return;

  const out: string[] = [];
  const seen = new Set<string>();
  const pending: Array<{ index: number; source: string }> = [];

  for (const feature of features) {
    if (typeof feature !== "string" || !feature.trim()) continue;

    const curated = resolveAmenityLabel(feature, target);
    const label = curated ?? feature.trim();
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const index = out.length;
    out.push(label);
    if (!curated && queue) pending.push({ index, source: label });
  }

  (container as { roomTypeFeatures?: unknown }).roomTypeFeatures = out;

  for (const { index, source } of pending) {
    queue!.texts.push(source);
    queue!.setters.push((translated) => {
      out[index] = translated;
    });
  }
};

const collectReducedDetailDescriptions = (
  data: unknown,
  texts: string[],
  setters: Array<(translated: string) => void>,
  localEnByRoomTypeID?: LocalEnByRoomTypeID
) => {
  if (!isObjectRecord(data)) return;

  const localEn = localEnByRoomTypeID?.get(getRoomTypeID(data) ?? "");

  const roomTypeName = (data as any).roomTypeName;
  const nameEn = localEn?.nameEn?.trim();
  if (typeof roomTypeName === "string" && nameEn) {
    (data as any).roomTypeName = TranslationSanitizer.sanitizeTranslatedText(nameEn);
  }

  const roomTypeDescription = (data as any).roomTypeDescription;
  const descriptionEn = localEn?.descriptionEn?.trim();
  if (typeof roomTypeDescription === "string" && roomTypeDescription.trim()) {
    if (descriptionEn) {
      (data as any).roomTypeDescription = TranslationSanitizer.sanitizeTranslatedText(descriptionEn);
    } else {
      texts.push(roomTypeDescription);
      setters.push((translated) => {
        (data as any).roomTypeDescription = translated;
      });
    }
  }

  const bedrooms = (data as HasBedrooms).bedrooms;
  if (Array.isArray(bedrooms)) {
    for (const b of bedrooms) {
      if (!isObjectRecord(b)) continue;
      const desc = (b as BedroomLike).description;
      if (typeof desc !== "string") continue;
      if (!desc.trim()) continue;

      texts.push(desc);
      setters.push((translated) => {
        (b as any).description = translated;
      });
    }
  }

  // En el detalle las comodidades cuelgan directo de `data` (no de `presentation`, como en el listado).
  localizeFeatures(data, "en", { texts, setters });
};

const collectReducedListNames = (data: unknown, localEnByRoomTypeID?: LocalEnByRoomTypeID) => {
  if (!Array.isArray(data)) return;

  for (const item of data) {
    if (!isObjectRecord(item)) continue;

    const localEn = localEnByRoomTypeID?.get(getRoomTypeID(item) ?? "");
    const roomTypeName = (item as any).roomTypeName;
    const nameEn = localEn?.nameEn?.trim();
    if (typeof roomTypeName === "string" && nameEn) {
      (item as any).roomTypeName = TranslationSanitizer.sanitizeTranslatedText(nameEn);
    }
  }
};

const collectRoomTypeSpecsBedroomsDescriptions = (data: unknown, texts: string[], setters: Array<(translated: string) => void>) => {
  if (!isObjectRecord(data)) return;

  const bedrooms = (data as HasBedrooms).bedrooms;
  if (!Array.isArray(bedrooms)) return;

  for (const b of bedrooms) {
    if (!isObjectRecord(b)) continue;
    const desc = (b as BedroomLike).description;
    if (typeof desc !== "string") continue;
    if (!desc.trim()) continue;

    texts.push(desc);
    setters.push((translated) => {
      (b as any).description = translated;
    });
  }
};

export const RoomTypeTranslationService = {
  /**
   * Normaliza las comodidades al idioma pedido usando SOLO el glosario, sin tocar el traductor.
   *
   * Es la contraparte en español de lo que la rama en inglés ya hacía de paso: el catálogo de
   * CloudBeds mezcla idiomas, así que la ficha en español mostraba «Coffee maker» y «Cribs upon
   * request» sin traducir. Como la rama en español no pasaba por ninguna transformación, hay que
   * llamarla explícitamente desde el controlador.
   *
   * Clona antes de tocar nada: el payload sale de la capa de CloudBeds, que cachea sus respuestas,
   * y mutarlo en el lugar contaminaría esa caché para el resto de los idiomas.
   */
  localizeAmenities<T>(payload: T, target: AmenityLocale): T {
    const cloned = deepClone(payload);
    if (!isObjectRecord(cloned)) return cloned;

    const data = (cloned as PayloadWithData).data;
    if (Array.isArray(data)) {
      // Listado: las comodidades cuelgan de `presentation` de cada propiedad.
      for (const item of data) {
        if (!isObjectRecord(item)) continue;
        localizeFeatures((item as HasPresentation).presentation, target);
      }
    } else {
      // Detalle: cuelgan directo de `data`.
      localizeFeatures(data, target);
    }

    return cloned;
  },

  async translateRoomsShowPayloadToEnglish<T>(payload: T, localEnByRoomTypeID?: LocalEnByRoomTypeID): Promise<T> {
    const cloned = deepClone(payload);

    if (!isObjectRecord(cloned)) return cloned;

    const data = (cloned as PayloadWithData).data;

    const texts: string[] = [];
    const setters: Array<(translated: string) => void> = [];

    // /api/rooms/show: data = RoomTypeModel[]; traducible: presentation.roomTypeDescription
    // (y presentation.roomTypeName / roomTypeFeatures cuando hay inglés persistido localmente).
    collectRoomTypeDescriptions(data, texts, setters, localEnByRoomTypeID);
    // Comodidades de CloudBeds: en el listado cuelgan de `presentation` de cada propiedad.
    if (Array.isArray(data)) {
      for (const item of data) {
        if (!isObjectRecord(item)) continue;
        localizeFeatures((item as HasPresentation).presentation, "en", { texts, setters });
      }
    }

    if (texts.length === 0) return cloned;

    const translated = await TranslateService.translateManySpanishToEnglish(texts);
    for (let i = 0; i < setters.length; i++) {
      const t = translated[i] ?? texts[i];
      const sanitized = TranslationSanitizer.sanitizeTranslatedText(t);
      setters[i](sanitized);
    }

    return cloned;
  },

  async translateRoomsShowByIdPayloadToEnglish<T>(payload: T, localEnByRoomTypeID?: LocalEnByRoomTypeID): Promise<T> {
    const cloned = deepClone(payload);

    if (!isObjectRecord(cloned)) return cloned;

    const data = (cloned as PayloadWithData).data;

    const texts: string[] = [];
    const setters: Array<(translated: string) => void> = [];

    // /api/rooms/show/{roomTypeID}: data = RoomTypeReducedDetail; traducible: roomTypeName,
    // roomTypeDescription y bedrooms[].description
    collectReducedDetailDescriptions(data, texts, setters, localEnByRoomTypeID);

    if (texts.length === 0) return cloned;

    const translated = await TranslateService.translateManySpanishToEnglish(texts);
    for (let i = 0; i < setters.length; i++) {
      const t = translated[i] ?? texts[i];
      const sanitized = TranslationSanitizer.sanitizeTranslatedText(t);
      setters[i](sanitized);
    }

    return cloned;
  },

  async translateRoomsShowLitePayloadToEnglish<T>(payload: T, localEnByRoomTypeID?: LocalEnByRoomTypeID): Promise<T> {
    const cloned = deepClone(payload);

    if (!isObjectRecord(cloned)) return cloned;

    const data = (cloned as PayloadWithData).data;

    // /api/rooms/show-lite: data = RoomTypeReduced[] (planos, sin `presentation`); traducible:
    // roomTypeName, solo cuando hay inglés persistido localmente (sin traducción en vivo, igual
    // que en /api/rooms/show).
    collectReducedListNames(data, localEnByRoomTypeID);

    return cloned;
  },

  async translateRoomTypeSpecsPayloadToEnglish<T>(payload: T): Promise<T> {
    const cloned = deepClone(payload);

    if (!isObjectRecord(cloned)) return cloned;

    const data = (cloned as PayloadWithData).data;

    const texts: string[] = [];
    const setters: Array<(translated: string) => void> = [];

    // /api/room-type-specs/{roomTypeID}: data = RoomTypeLocalSpecs; traducible: bedrooms[].description
    collectRoomTypeSpecsBedroomsDescriptions(data, texts, setters);

    if (texts.length === 0) return cloned;

    const translated = await TranslateService.translateManySpanishToEnglish(texts);
    for (let i = 0; i < setters.length; i++) {
      const t = translated[i] ?? texts[i];
      const sanitized = TranslationSanitizer.sanitizeTranslatedText(t);
      setters[i](sanitized);
    }

    return cloned;
  },
};
