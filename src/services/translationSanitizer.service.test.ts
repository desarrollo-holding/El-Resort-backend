import { describe, it, expect } from "vitest";
import { TranslationSanitizer } from "./translationSanitizer.service";

const drop = TranslationSanitizer.dropDegenerateTranslations;

/**
 * Caso real: el título «DESCUBRE EL RESORT» (todo en mayúsculas) volvió de Gemini como `"_"`, se
 * persistió, y a partir de ahí ganó sobre la copia de respaldo del front —que sí tenía «DISCOVER
 * THE RESORT»—. Un valor así es peor que no traducir.
 */
describe("TranslationSanitizer.dropDegenerateTranslations", () => {
  it("quita la clave cuya traducción se quedó sin letras ni números", () => {
    const es = { title: "DESCUBRE EL RESORT", subtitle: "Conócelo" };
    const en = { title: "_", subtitle: "Get to know it" };

    expect(drop(es, en)).toEqual({ subtitle: "Get to know it" });
  });

  it("conserva los valores que ya venían sin letras, como un ancla '#'", () => {
    // La fuente tampoco tiene letras: no se perdió nada en la traducción, es un href legítimo.
    const es = { href: "#", label: "Ver más" };
    const en = { href: "#", label: "See more" };

    expect(drop(es, en)).toEqual({ href: "#", label: "See more" });
  });

  it("limpia en profundidad sin tocar las ramas sanas", () => {
    const es = { cards: { a: { title: "Ubicación", cta: "Abrir mapa" }, b: { title: "Restaurante" } } };
    const en = { cards: { a: { title: "Location", cta: "   " }, b: { title: "Restaurant" } } };

    expect(drop(es, en)).toEqual({
      cards: { a: { title: "Location" }, b: { title: "Restaurant" } },
    });
  });

  it("descarta el arreglo entero si falla un elemento (el front lo lee por posición)", () => {
    const es = { items: ["Uno", "Dos"] };
    const en = { items: ["One", "-"] };

    expect(drop(es, en)).toEqual({});
  });

  it("devuelve undefined si no quedó nada aprovechable", () => {
    expect(drop({ title: "Hola" }, { title: "_" })).toEqual({});
    expect(drop("Hola", "_")).toBeUndefined();
  });

  it("no toca números ni booleanos", () => {
    const es = { orden: 3, activo: true, title: "Hola" };
    const en = { orden: 3, activo: true, title: "Hello" };

    expect(drop(es, en)).toEqual({ orden: 3, activo: true, title: "Hello" });
  });

  it("descarta la rama si el traductor cambió la forma del objeto", () => {
    expect(drop({ a: { b: "Hola" } }, { a: "Hello" })).toEqual({});
  });
});
