/**
 * Glosario bidireccional de las comodidades (`roomTypeFeatures`) que CloudBeds devuelve por
 * propiedad, y que la ficha pinta como «beneficios incluidos».
 *
 * POR QUÉ ES BIDIRECCIONAL Y NO SOLO es→en
 * El catálogo de CloudBeds está cargado a mano y mezcla los dos idiomas: hay comodidades escritas
 * en español («Hervidor», «Mosquiteros») y otras en inglés («Coffee maker», «Cribs upon request»),
 * a veces en la MISMA propiedad. Traducir solo hacia el inglés dejaba la ficha en español con
 * «Coffee maker» y «Cribs upon request» a medias. Con el glosario en las dos direcciones, la lista
 * sale entera en el idioma pedido sin importar en cuál la cargaron.
 *
 * POR QUÉ NO ALCANZA EL TRADUCTOR AUTOMÁTICO
 * Son etiquetas de una o dos palabras, sin ninguna frase alrededor de la que sacar contexto, y ahí
 * Gemini/LibreTranslate fallan feo. Medido contra este mismo catálogo: «Hervidor» → «Breast»,
 * «Mosquitero» → «Musketeer», «Colgadores» → «Paddles», y «Tumbonas» volvía sin traducir. Un
 * glosario a mano es más barato (cero llamadas), instantáneo y, sobre todo, correcto para un
 * conjunto que es chico y casi fijo.
 *
 * El traductor NO se elimina: sigue siendo el respaldo para cualquier comodidad nueva que aparezca
 * en CloudBeds y todavía no esté acá, pero solo en la dirección es→en (ver `localizeFeatures` en
 * roomTypeTranslation.service.ts). Agregar una fila acá es lo que la saca de esa ruta.
 *
 * Las claves se normalizan (minúsculas, sin acentos, espacios colapsados), así que una sola entrada
 * cubre las variantes que conviven en el catálogo: «Artículos de aseo»/«Articulos de aseo»,
 * «Jardín»/«Jardin», «Hervidor eléctrico»/«Hervidor electrico».
 */

export type AmenityLocale = "es" | "en";

type AmenityEntry = {
  es: string;
  en: string;
  /** Otras grafías con las que la misma comodidad aparece cargada en CloudBeds. */
  aliases?: string[];
};

/** minúsculas, sin acentos y con los espacios colapsados: la forma en que se indexa el glosario. */
const normalizeAmenityKey = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const AMENITIES: AmenityEntry[] = [
  // — Cocina y menaje —
  { es: "Menaje", en: "Kitchenware" },
  { es: "Hervidor", en: "Kettle" },
  { es: "Hervidor eléctrico", en: "Electric kettle", aliases: ["Hervidor electrico"] },
  { es: "Cafetera", en: "Coffee maker" },
  { es: "Minibar", en: "Minibar" },
  // «Frigobar» y «Minibar» llegan como comodidades distintas en la misma propiedad; mapearlas a la
  // misma etiqueta las dejaba duplicadas en la ficha, así que cada una conserva su matiz.
  { es: "Frigobar", en: "Mini fridge" },
  { es: "Comedor", en: "Dining area" },

  // — Dormitorio y baño —
  { es: "Artículos de aseo", en: "Toiletries", aliases: ["Articulos de aseo"] },
  { es: "Colgadores", en: "Hangers" },
  { es: "Perchero", en: "Coat rack" },
  { es: "Cojines", en: "Cushions" },
  { es: "Mosquitero", en: "Mosquito net" },
  { es: "Mosquiteros", en: "Mosquito nets" },
  { es: "Lámpara", en: "Lamp", aliases: ["Lampara"] },
  { es: "Linterna", en: "Flashlight" },
  { es: "Secadora de pelo", en: "Hairdryer" },
  { es: "Batas de baño", en: "Bathrobes" },
  { es: "Cunas a pedido", en: "Cribs upon request" },

  // — Exterior —
  { es: "Jardín", en: "Garden", aliases: ["Jardin"] },
  { es: "Hamaca", en: "Hammock" },
  { es: "Hamacas", en: "Hammocks" },
  { es: "Tumbonas", en: "Sun loungers" },
  { es: "Muebles exterior", en: "Outdoor furniture" },
  { es: "Sillas exteriores", en: "Outdoor chairs" },
  { es: "Piscina", en: "Pool" },
  { es: "Piscina privada", en: "Private pool" },
  { es: "Estacionamiento", en: "Parking" },
  { es: "Deck", en: "Deck" },
  { es: "2 decks", en: "2 Decks", aliases: ["2 Deck"] },
  { es: "Puff", en: "Pouf" },
  { es: "Puffs", en: "Poufs" },

  // — Ocio, conectividad y climatización —
  { es: "Juegos de mesa", en: "Board games" },
  { es: "Televisor", en: "TV" },
  { es: "Televisión por cable", en: "Cable television" },
  { es: "Netflix", en: "Netflix" },
  { es: "Ventilador de piso", en: "Floor fan" },
  { es: "Internet inalámbrico (WiFi)", en: "Wireless internet (WiFi)" },
  {
    es: "Internet inalámbrico (WiFi) - con costo",
    en: "Wireless internet (WiFi) - fee",
  },
  { es: "Circuitos de 220-240 voltios", en: "220-240 volt circuits" },
];

/** Cada grafía conocida (español, inglés y alias) apunta a su entrada. */
const byKey = new Map<string, AmenityEntry>();
for (const entry of AMENITIES) {
  for (const spelling of [entry.es, entry.en, ...(entry.aliases ?? [])]) {
    byKey.set(normalizeAmenityKey(spelling), entry);
  }
}

/**
 * Etiqueta curada de una comodidad en el idioma pedido, sin importar en cuál venga escrita, o
 * `undefined` si no está en el glosario — en cuyo caso el llamador decide (traductor automático
 * hacia el inglés, o dejarla tal cual).
 */
export function resolveAmenityLabel(feature: string, target: AmenityLocale): string | undefined {
  const entry = byKey.get(normalizeAmenityKey(feature));
  return entry ? entry[target] : undefined;
}

/** Solo para tests: el catálogo completo, para comprobar cobertura y que no haya grafías repetidas. */
export const __amenitiesForTests = AMENITIES;
