export const TranslationSanitizer = {
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
