import { describe, it, expect } from "vitest";
import { resolveAmenityLabel, __amenitiesForTests } from "./roomAmenityGlossary";

/**
 * Inventario real de `roomTypeFeatures` que hoy devuelve CloudBeds para las 16 propiedades
 * (recolectado recorriendo `/api/rooms/show/{id}?idioma=es`). Mezcla las dos grafías de varias
 * comodidades y los dos idiomas, que es justamente lo que el glosario tiene que absorber.
 *
 * Si CloudBeds suma una comodidad nueva este test no falla -para eso está el respaldo del traductor
 * automático-, pero sirve de lista de referencia para mantener el glosario al día.
 */
const CATALOGO_ACTUAL = [
  "Coffee maker",
  "Minibar",
  "Wireless internet (WiFi)",
  "Wireless internet (WiFi) - fee",
  "Cribs upon request",
  "Menaje",
  "Hervidor",
  "Hervidor electrico",
  "Hervidor eléctrico",
  "Colgadores",
  "Artículos de aseo",
  "Articulos de aseo",
  "Comedor",
  "Deck",
  "2 Deck",
  "Hamaca",
  "Hamacas",
  "Jardín",
  "Jardin",
  "Netflix",
  "Cable television",
  "Estacionamiento",
  "Puff",
  "Puffs",
  "220-240 volt circuits",
  "Hairdryer",
  "Piscina privada",
  "Piscina",
  "Frigobar",
  "Mosquitero",
  "Mosquiteros",
  "Televisor",
  "TV",
  "Ventilador de piso",
  "Juegos de mesa",
  "Tumbonas",
  "Cojines",
  "Linterna",
  "Cafetera",
  "Muebles exterior",
  "Perchero",
  "Sillas exteriores",
  "Lámpara",
  "Lampara",
  "Bathrobes",
];

describe("roomAmenityGlossary", () => {
  it("cubre en los dos idiomas todas las comodidades del catálogo actual de CloudBeds", () => {
    const sinEs = CATALOGO_ACTUAL.filter((f) => !resolveAmenityLabel(f, "es"));
    const sinEn = CATALOGO_ACTUAL.filter((f) => !resolveAmenityLabel(f, "en"));
    expect(sinEs).toEqual([]);
    expect(sinEn).toEqual([]);
  });

  it("traduce al inglés lo que llega en español", () => {
    expect(resolveAmenityLabel("Hervidor", "en")).toBe("Kettle");
    expect(resolveAmenityLabel("Colgadores", "en")).toBe("Hangers");
    expect(resolveAmenityLabel("Estacionamiento", "en")).toBe("Parking");
  });

  // Lo que reportó el cliente: la ficha en ESPAÑOL mostraba estas tal cual venían de CloudBeds.
  it("traduce al español lo que llega en inglés", () => {
    expect(resolveAmenityLabel("Coffee maker", "es")).toBe("Cafetera");
    expect(resolveAmenityLabel("Cribs upon request", "es")).toBe("Cunas a pedido");
    expect(resolveAmenityLabel("Wireless internet (WiFi) - fee", "es")).toBe(
      "Internet inalámbrico (WiFi) - con costo"
    );
    expect(resolveAmenityLabel("Hairdryer", "es")).toBe("Secadora de pelo");
    expect(resolveAmenityLabel("Bathrobes", "es")).toBe("Batas de baño");
  });

  it("corrige justo las que el traductor automático destrozaba", () => {
    // Traducciones reales observadas antes del glosario, con Gemini/LibreTranslate.
    expect(resolveAmenityLabel("Hervidor", "en")).toBe("Kettle"); // devolvía "Breast"
    expect(resolveAmenityLabel("Mosquitero", "en")).toBe("Mosquito net"); // devolvía "Musketeer"
    expect(resolveAmenityLabel("Colgadores", "en")).toBe("Hangers"); // devolvía "Paddles"
    expect(resolveAmenityLabel("Tumbonas", "en")).toBe("Sun loungers"); // volvía sin traducir
  });

  it("normaliza acentos, mayúsculas y espacios de más", () => {
    expect(resolveAmenityLabel("Artículos de aseo", "en")).toBe("Toiletries");
    expect(resolveAmenityLabel("articulos de aseo", "en")).toBe("Toiletries");
    expect(resolveAmenityLabel("  ARTICULOS   DE  ASEO  ", "en")).toBe("Toiletries");
    expect(resolveAmenityLabel("Jardin", "es")).toBe("Jardín");
    expect(resolveAmenityLabel("Hervidor electrico", "es")).toBe("Hervidor eléctrico");
  });

  it("distingue singular de plural cuando el catálogo trae las dos", () => {
    expect(resolveAmenityLabel("Hamaca", "en")).toBe("Hammock");
    expect(resolveAmenityLabel("Hamacas", "en")).toBe("Hammocks");
    expect(resolveAmenityLabel("Mosquitero", "en")).toBe("Mosquito net");
    expect(resolveAmenityLabel("Mosquiteros", "en")).toBe("Mosquito nets");
  });

  // «Minibar» y «Frigobar» llegan como filas distintas en la misma propiedad: si las dos apuntaran
  // a la misma etiqueta, la ficha las mostraría duplicadas.
  it("no colapsa Minibar y Frigobar en la misma etiqueta", () => {
    expect(resolveAmenityLabel("Minibar", "en")).not.toBe(resolveAmenityLabel("Frigobar", "en"));
    expect(resolveAmenityLabel("Minibar", "es")).not.toBe(resolveAmenityLabel("Frigobar", "es"));
  });

  it("ninguna grafía está declarada en dos entradas distintas", () => {
    const vistas = new Map<string, string>();
    for (const entry of __amenitiesForTests) {
      for (const grafia of [entry.es, entry.en, ...(entry.aliases ?? [])]) {
        const key = grafia
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .trim();
        const previa = vistas.get(key);
        expect(previa ?? entry.es, `"${grafia}" está en dos entradas`).toBe(entry.es);
        vistas.set(key, entry.es);
      }
    }
  });

  it("devuelve undefined para lo que no conoce, para que caiga al traductor", () => {
    expect(resolveAmenityLabel("Chimenea a leña", "en")).toBeUndefined();
    expect(resolveAmenityLabel("", "en")).toBeUndefined();
  });
});
