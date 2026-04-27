import { pickFirstQueryValue } from "./http";

export type Idioma = "es" | "en";

export const parseIdiomaQuery = (value: unknown): Idioma | null => {
  const raw = pickFirstQueryValue(value);
  if (!raw) return null;

  const normalized = raw.trim().toLowerCase();
  if (normalized === "es" || normalized === "en") return normalized;
  return null;
};
