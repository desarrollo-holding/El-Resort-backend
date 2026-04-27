import { GoogleTranslateService } from "./googleTranslate.service";

type JsonRecord = Record<string, unknown>;

const isObjectRecord = (value: unknown): value is JsonRecord => !!value && typeof value === "object" && !Array.isArray(value);

const isProbablyUrlOrLink = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;

  // Common URL / link schemes
  if (/^(https?:)?\/\//i.test(trimmed)) return true;
  if (/^(data|mailto|tel):/i.test(trimmed)) return true;

  // Other scheme:// patterns
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return true;

  return false;
};

const hasLetters = (value: string): boolean => {
  try {
    return /\p{L}/u.test(value);
  } catch {
    // Fallback for older regex engines
    return /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(value);
  }
};

const shouldTranslateString = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (isProbablyUrlOrLink(trimmed)) return false;
  if (!hasLetters(trimmed)) return false;

  return true;
};

const deepClone = <T>(value: T): T => {
  const anyGlobal = globalThis as any;
  if (typeof anyGlobal.structuredClone === "function") {
    return anyGlobal.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

type StringRef = { container: any; key: string | number; text: string };

const collectTranslatableStrings = (value: unknown, refs: StringRef[]): void => {
  if (typeof value === "string") return;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === "string") {
        if (shouldTranslateString(item)) refs.push({ container: value, key: i, text: item });
        continue;
      }
      collectTranslatableStrings(item, refs);
    }
    return;
  }

  if (!isObjectRecord(value)) return;

  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") {
      if (shouldTranslateString(v)) refs.push({ container: value, key: k, text: v });
      continue;
    }
    collectTranslatableStrings(v, refs);
  }
};

export const ResponseTranslationService = {
  async translateValuesToEnglish<T>(payload: T): Promise<T> {
    const cloned = deepClone(payload);

    const refs: StringRef[] = [];
    collectTranslatableStrings(cloned, refs);

    if (refs.length === 0) return cloned;

    const uniqueTexts: string[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      const text = ref.text;
      if (seen.has(text)) continue;
      seen.add(text);
      uniqueTexts.push(text);
    }

    const translatedList = await GoogleTranslateService.translateManySpanishToEnglish(uniqueTexts, { delayMs: 250 });
    const map = new Map<string, string>();
    for (let i = 0; i < uniqueTexts.length; i++) {
      map.set(uniqueTexts[i], translatedList[i] ?? uniqueTexts[i]);
    }

    for (const ref of refs) {
      ref.container[ref.key] = map.get(ref.text) ?? ref.text;
    }

    return cloned;
  },
};
