import { LibreTranslateService } from "./libreTranslate.service";
import { TranslationSanitizer } from "./translationSanitizer.service";

type JsonRecord = Record<string, unknown>;

type BedroomLike = { description?: unknown };

type HasPresentation = { presentation?: unknown };

type PresentationLike = { roomTypeDescription?: unknown };

type HasBedrooms = { bedrooms?: unknown };

type PayloadWithData = { data?: unknown };

const isObjectRecord = (value: unknown): value is JsonRecord => !!value && typeof value === "object" && !Array.isArray(value);

const deepClone = <T>(value: T): T => {
  const anyGlobal = globalThis as any;
  if (typeof anyGlobal.structuredClone === "function") {
    return anyGlobal.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const collectRoomTypeDescriptions = (data: unknown, texts: string[], setters: Array<(translated: string) => void>) => {
  if (!Array.isArray(data)) return;

  for (const item of data) {
    if (!isObjectRecord(item)) continue;

    const presentation = (item as HasPresentation).presentation;
    if (!isObjectRecord(presentation)) continue;

    const roomTypeDescription = (presentation as PresentationLike).roomTypeDescription;
    if (typeof roomTypeDescription !== "string") continue;
    const trimmed = roomTypeDescription.trim();
    if (!trimmed) continue;

    texts.push(roomTypeDescription);
    setters.push((translated) => {
      (presentation as any).roomTypeDescription = translated;
    });
  }
};

const collectReducedDetailDescriptions = (data: unknown, texts: string[], setters: Array<(translated: string) => void>) => {
  if (!isObjectRecord(data)) return;

  const roomTypeDescription = (data as any).roomTypeDescription;
  if (typeof roomTypeDescription === "string" && roomTypeDescription.trim()) {
    texts.push(roomTypeDescription);
    setters.push((translated) => {
      (data as any).roomTypeDescription = translated;
    });
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
  async translateRoomsShowPayloadToEnglish<T>(payload: T): Promise<T> {
    const cloned = deepClone(payload);

    if (!isObjectRecord(cloned)) return cloned;

    const data = (cloned as PayloadWithData).data;

    const texts: string[] = [];
    const setters: Array<(translated: string) => void> = [];

    // /api/rooms/show: data = RoomTypeModel[]; traducible: presentation.roomTypeDescription
    collectRoomTypeDescriptions(data, texts, setters);
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

    const translated = await LibreTranslateService.translateManySpanishToEnglish(texts);
    for (let i = 0; i < setters.length; i++) {
      const t = translated[i] ?? texts[i];
      const sanitized = TranslationSanitizer.sanitizeTranslatedText(t);
      setters[i](sanitized);
    }

    return cloned;
  },

  async translateRoomsShowByIdPayloadToEnglish<T>(payload: T): Promise<T> {
    const cloned = deepClone(payload);

    if (!isObjectRecord(cloned)) return cloned;

    const data = (cloned as PayloadWithData).data;

    const texts: string[] = [];
    const setters: Array<(translated: string) => void> = [];

    // /api/rooms/show/{roomTypeID}: data = RoomTypeReducedDetail; traducible: roomTypeDescription y bedrooms[].description
    collectReducedDetailDescriptions(data, texts, setters);

    if (texts.length === 0) return cloned;

    const translated = await LibreTranslateService.translateManySpanishToEnglish(texts);
    for (let i = 0; i < setters.length; i++) {
      const t = translated[i] ?? texts[i];
      const sanitized = TranslationSanitizer.sanitizeTranslatedText(t);
      setters[i](sanitized);
    }

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

    const translated = await LibreTranslateService.translateManySpanishToEnglish(texts);
    for (let i = 0; i < setters.length; i++) {
      const t = translated[i] ?? texts[i];
      const sanitized = TranslationSanitizer.sanitizeTranslatedText(t);
      setters[i](sanitized);
    }

    return cloned;
  },
};
