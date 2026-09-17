/** Marca interna: esta rama del objeto traducido no es usable y hay que quitarla. */
const DROP = Symbol("drop");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** ¿Tiene al menos una letra o un número? `"_"`, `"-"`, `"..."` y `""` no. */
const hasMeaningfulContent = (value: string): boolean => /[\p{L}\p{N}]/u.test(value);

/**
 * Recorre el objeto traducido en paralelo con su fuente y marca lo que volvió inservible.
 *
 * El caso que motivó esto: el título «DESCUBRE EL RESORT» (todo en mayúsculas) volvió de Gemini
 * como `"_"`. Un valor así es PEOR que no traducir, porque se persiste y a partir de ahí gana sobre
 * la copia de respaldo del front, que sí tenía el texto correcto.
 */
const sanitizeBranch = (source: unknown, translated: unknown): unknown | typeof DROP => {
  if (typeof source === "string") {
    if (typeof translated !== "string") return DROP;
    // La fuente tenía contenido real y la traducción no: la traducción se perdió por el camino.
    if (hasMeaningfulContent(source) && !hasMeaningfulContent(translated)) return DROP;
    return translated;
  }

  if (Array.isArray(source)) {
    // Un arreglo se descarta entero si falla cualquier elemento: quitar solo uno correría los
    // índices, y el front lee estas listas por posición.
    if (!Array.isArray(translated) || translated.length !== source.length) return DROP;
    const out = source.map((item, i) => sanitizeBranch(item, translated[i]));
    return out.some((item) => item === DROP) ? DROP : out;
  }

  if (isPlainObject(source)) {
    if (!isPlainObject(translated)) return DROP;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      const branch = sanitizeBranch(value, translated[key]);
      if (branch !== DROP) out[key] = branch;
    }
    return out;
  }

  // Números, booleanos y null no se traducen; se conserva lo que haya vuelto.
  return translated === undefined ? source : translated;
};

export const TranslationSanitizer = {
  /**
   * Devuelve el objeto traducido SIN las claves cuya traducción volvió vacía o sin letras ni
   * números, o `undefined` si no quedó nada aprovechable.
   *
   * Quitar la clave (en vez de dejar el español) es deliberado: el front resuelve cada clave por
   * separado y, al no encontrarla en el diccionario del servidor, cae a su copia de respaldo en
   * inglés — que para esa clave es mejor que texto en español o que un `"_"`.
   */
  dropDegenerateTranslations(source: unknown, translated: unknown): unknown | undefined {
    const result = sanitizeBranch(source, translated);
    return result === DROP ? undefined : result;
  },

  sanitizeTranslatedText(text: string): string {
    if (typeof text !== "string" || (text.indexOf("<") === -1 && text.indexOf(">") === -1)) return text;

    let out = String(text);

    // Add a space after '>' when the next character is a non-space and not a '<'
    out = out.replace(/>(?=[^\s<])/g, "> ");

    // Add a space before '<' when the previous character is not whitespace and not '>'
    out = out.replace(/([^>\s])</g, "$1 <");

    // Collapse multiple spaces that might be introduced (but keep single spaces)
    out = out.replace(/ {2,}/g, " ");

    return out;
  },
};
