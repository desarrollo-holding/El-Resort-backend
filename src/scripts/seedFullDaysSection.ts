/**
 * Registra la sección `fullDaysSection` del landing y sus textos es/en — idempotente: lo que ya
 * existe no se toca.
 *
 *   npx ts-node src/scripts/seedFullDaysSection.ts
 *
 * Sin la fila de sección el dashboard no puede guardar textos ni carrusel de la vista /full-days
 * (`TextosLandingPage` y `LandingMedia` la referencian por `_id`, y el PATCH no se envía mientras
 * no exista). Sin las filas de textos, la sección abre en "No encontrado" y no hay campos que
 * editar: el contenido inicial de acá es el mismo que traen los JSON de i18n del frontend.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import LandingPageSection from "../models/LandingPageSection";
import TextosLandingPage from "../models/TextosLandingPage";

dotenv.config();

const SECTION_NAME = "fullDaysSection";

const TEXTOS_ES = {
  title: "Full Days",
  description:
    "¿Poco tiempo? Vive El Resort de Yanashpa en <strong>un solo día</strong>: naturaleza, piscina y buena comida, <strong>sin quedarte a dormir</strong>.",
  cardsSectionTitle: "Un día completo\nen medio de la naturaleza",
  buttons: {
    resort: "Conocer el Resort",
    fullDays: "Ver Full Days",
  },
  cards: {
    soldOut: "Sold out",
    perPerson: "por persona",
    noStay: "No incluye estadía",
    more: "Ver más",
    check: "Consultar disponibilidad",
    error: "No pudimos cargar los full days.",
    empty: "No hay full days disponibles por el momento.",
    schedule: "9:00 am a 6:00 pm",
    capacityPrefix: "Hasta",
    person: "persona",
    people: "personas",
    back: {
      includesTitle: "Tu día incluye:",
      datesTitle: "Fechas:",
      timeTitle: "Tiempo:",
      datesFallback: "A coordinar según disponibilidad",
    },
  },
};

const TEXTOS_EN = {
  title: "Full Days",
  description:
    "Short on time? Experience the Yanashpa Resort in <strong>a single day</strong>: nature, pool and great food, <strong>without staying overnight</strong>.",
  cardsSectionTitle: "A full day\nsurrounded by nature",
  buttons: {
    resort: "Discover the Resort",
    fullDays: "View Full Days",
  },
  cards: {
    soldOut: "Sold out",
    perPerson: "per person",
    noStay: "Does not include stay",
    more: "See more",
    check: "Check availability",
    error: "We couldn't load the full days.",
    empty: "There are no full days available at the moment.",
    schedule: "9:00 am to 6:00 pm",
    capacityPrefix: "Up to",
    person: "person",
    people: "people",
    back: {
      includesTitle: "Your day comes with:",
      datesTitle: "Dates:",
      timeTitle: "Duration:",
      datesFallback: "To be arranged based on availability",
    },
  },
};

async function main() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL no está definido.");

  await mongoose.connect(databaseUrl);

  let section = await LandingPageSection.findOne({ name: SECTION_NAME });
  if (section) {
    console.log(`Sección: ya existía ${SECTION_NAME} (_id ${section._id}).`);
  } else {
    section = await LandingPageSection.create({ name: SECTION_NAME });
    console.log(`Sección: creada ${SECTION_NAME} (_id ${section._id}).`);
  }

  for (const [idioma, json] of [
    ["es", TEXTOS_ES],
    ["en", TEXTOS_EN],
  ] as const) {
    const existing = await TextosLandingPage.findOne({ section: section._id, idioma });
    if (!existing) {
      const created = await TextosLandingPage.create({ idioma, section: section._id, json });
      console.log(`Textos ${idioma}: creados (_id ${created._id}).`);
      continue;
    }

    // `title`, `description` y `cardsSectionTitle` los edita el admin desde el dashboard: nunca se
    // pisan. `buttons` y `cards` son etiquetas de UI que el dashboard oculta, así que se refrescan
    // desde acá para que no queden desfasadas cuando la card cambia.
    const current = (existing.json ?? {}) as Record<string, unknown>;
    existing.set("json", { ...current, buttons: json.buttons, cards: json.cards });
    existing.markModified("json");
    await existing.save();
    console.log(`Textos ${idioma}: ya existían (_id ${existing._id}); se refrescaron buttons/cards.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
