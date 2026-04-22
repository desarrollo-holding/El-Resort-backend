export const asNonEmptyTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
};

export const asNonEmptyTrimmedStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);

  return normalized.length ? normalized : undefined;
};

export const stringifyJsonForModel = (obj: unknown): string => {
  try {
    return JSON.stringify(obj);
  } catch (err) {
    // Fallback: attempt a safe stringify
    return JSON.stringify(obj, (_k, v) => (v === undefined ? null : v));
  }
};
