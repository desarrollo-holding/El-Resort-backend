import { TranslateService } from "./translate.service";
import { TranslationSanitizer } from "./translationSanitizer.service";

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

const deepClone = <T>(value: T): T => {
  const anyGlobal = globalThis as any;
  if (typeof anyGlobal.structuredClone === "function") {
    return anyGlobal.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

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
  async translateRoomsShowPayloadToEnglish<T>(payload: T, localEnByRoomTypeID?: LocalEnByRoomTypeID): Promise<T> {
    const cloned = deepClone(payload);

    if (!isObjectRecord(cloned)) return cloned;

    const data = (cloned as PayloadWithData).data;

    const texts: string[] = [];
    const setters: Array<(translated: string) => void> = [];

    // /api/rooms/show: data = RoomTypeModel[]; traducible: presentation.roomTypeDescription
    // (y presentation.roomTypeName / roomTypeFeatures cuando hay inglés persistido localmente).
    collectRoomTypeDescriptions(data, texts, setters, localEnByRoomTypeID);
    // Also translate presentation.roomTypeFeatures (array of strings)
    if (Array.isArray((data as any)?.map ? (data as any).map((x: any) => x) : [])) {
      // when data is array, collect features
      for (const item of (data as any)) {
        if (!item || typeof item !== "object") continue;
        const presentation = item.presentation;
        if (!presentation || typeof presentation !== "object") continue;
        const features = presentation.roomTypeFeatures;
        if (!Array.isArray(features)) continue;
        for (let fi = 0; fi < features.length; fi++) {
          const f = features[fi];
          if (typeof f !== "string") continue;
          const trimmed = f.trim();
          if (!trimmed) continue;
          texts.push(f);
          // setter captures item and index
          setters.push(((it: any, idx: number) => (translated: string) => {
            (it.presentation.roomTypeFeatures as string[])[idx] = translated;
          })(item, fi));
        }
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
