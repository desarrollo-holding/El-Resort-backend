import TextosLandingPage from "../models/TextosLandingPage";

export type TextoLandingPageDto = {
  id: string;
  idioma: string;
  section: string;
  sectionName?: string;
  json: unknown;
};

export type TextosLandingPageByIdiomaResponse = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const flattenObjectToDotPaths = (obj: Record<string, unknown>, basePath: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {};

  const visit = (value: unknown, currentPath: string): void => {
    if (Array.isArray(value)) {
      out[currentPath] = value;
      return;
    }

    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        out[currentPath] = {};
        return;
      }

      for (const [key, child] of entries) {
        visit(child, `${currentPath}.${key}`);
      }
      return;
    }

    out[currentPath] = value;
  };

  for (const [key, value] of Object.entries(obj)) {
    visit(value, `${basePath}.${key}`);
  }

  return out;
};

const toDto = (doc: { _id: unknown; idioma: string; section: unknown; json: unknown; sectionName?: string }): TextoLandingPageDto => ({
  id: String(doc._id),
  idioma: doc.idioma,
  section: String(doc.section),
  sectionName: doc.sectionName,
  json: doc.json,
});

export const TextosLandingPageService = {
  async create(idioma: string, section: string, json: unknown): Promise<TextoLandingPageDto> {
    const normalizedIdioma = idioma.trim().toLowerCase();
    if (normalizedIdioma !== "es" && normalizedIdioma !== "en") {
      throw new Error("idioma debe ser 'es' o 'en'");
    }

    const countForSection = await TextosLandingPage.countDocuments({ section });
    if (countForSection >= 2) {
      throw new Error("Solo se permiten 2 registros por section (idiomas distintos)");
    }

    const doc = await TextosLandingPage.create({ idioma: normalizedIdioma, section, json });
    return toDto(doc);
  },

  async updateById(id: string, payload: { json?: unknown }): Promise<TextoLandingPageDto | null> {
    const setPayload: Record<string, unknown> = {};

    if (payload.json !== undefined) {
      if (!isPlainObject(payload.json)) {
        throw new Error("json debe ser un objeto para patch parcial");
      }

      Object.assign(setPayload, flattenObjectToDotPaths(payload.json, "json"));
    }

    if (Object.keys(setPayload).length === 0) {
      throw new Error("Debes enviar al menos un campo para actualizar");
    }

    const doc = await TextosLandingPage.findByIdAndUpdate(id, { $set: setPayload }, {
      new: true,
      runValidators: true,
    }).lean();

    if (!doc) return null;
    return toDto(doc);
  },

  async deleteById(id: string): Promise<boolean> {
    const doc = await TextosLandingPage.findByIdAndDelete(id).lean();
    return !!doc;
  },

  async getById(id: string): Promise<TextoLandingPageDto | null> {
    const doc = await TextosLandingPage.findById(id).populate("section", "name").lean();
    if (!doc) return null;

    const sectionField = doc.section as { _id?: unknown; name?: unknown } | unknown;
    const sectionId =
      sectionField && typeof sectionField === "object" && "_id" in sectionField
        ? (sectionField as { _id: unknown })._id
        : doc.section;
    const sectionName =
      sectionField && typeof sectionField === "object" && "name" in sectionField && typeof (sectionField as { name?: unknown }).name === "string"
        ? ((sectionField as { name: string }).name)
        : undefined;

    return toDto({
      _id: doc._id,
      idioma: doc.idioma,
      section: sectionId,
      sectionName,
      json: doc.json,
    });
  },

  async getSpanishBySectionId(sectionId: string): Promise<TextoLandingPageDto | null> {
    const doc = await TextosLandingPage.findOne({ section: sectionId, idioma: "es" }).populate("section", "name").lean();
    if (!doc) return null;

    const sectionField = doc.section as { _id?: unknown; name?: unknown } | unknown;
    const normalizedSectionId =
      sectionField && typeof sectionField === "object" && "_id" in sectionField
        ? (sectionField as { _id: unknown })._id
        : doc.section;
    const sectionName =
      sectionField && typeof sectionField === "object" && "name" in sectionField && typeof (sectionField as { name?: unknown }).name === "string"
        ? (sectionField as { name: string }).name
        : undefined;

    return toDto({
      _id: doc._id,
      idioma: doc.idioma,
      section: normalizedSectionId,
      sectionName,
      json: doc.json,
    });
  },

  async getBySectionAndIdioma(sectionId: string, idioma: string): Promise<TextoLandingPageDto | null> {
    const normalizedIdioma = idioma.trim().toLowerCase();
    const doc = await TextosLandingPage.findOne({ section: sectionId, idioma: normalizedIdioma }).populate("section", "name").lean();
    if (!doc) return null;

    const sectionField = doc.section as { _id?: unknown; name?: unknown } | unknown;
    const normalizedSectionId =
      sectionField && typeof sectionField === "object" && "_id" in sectionField
        ? (sectionField as { _id: unknown })._id
        : doc.section;
    const sectionName =
      sectionField && typeof sectionField === "object" && "name" in sectionField && typeof (sectionField as { name?: unknown }).name === "string"
        ? (sectionField as { name: string }).name
        : undefined;

    return toDto({
      _id: doc._id,
      idioma: doc.idioma,
      section: normalizedSectionId,
      sectionName,
      json: doc.json,
    });
  },

  async upsertBySectionAndIdioma(sectionId: string, idioma: string, json: unknown): Promise<TextoLandingPageDto> {
    const normalizedIdioma = idioma.trim().toLowerCase();
    if (normalizedIdioma !== "es" && normalizedIdioma !== "en") {
      throw new Error("idioma debe ser 'es' o 'en'");
    }

    const doc = await TextosLandingPage.findOneAndUpdate(
      { section: sectionId, idioma: normalizedIdioma },
      { $set: { json } },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    if (!doc) {
      throw new Error("No se pudo upsert el registro");
    }

    return toDto(doc);
  },

  async listAll(): Promise<TextoLandingPageDto[]> {
    const docs = await TextosLandingPage.find({}).sort({ idioma: 1 }).lean();
    return docs.map(toDto);
  },

  async getAllSectionsByIdioma(idioma: string): Promise<TextosLandingPageByIdiomaResponse> {
    const docs = await TextosLandingPage.find({ idioma }).populate("section", "name").lean();
    const response: TextosLandingPageByIdiomaResponse = {};

    for (const doc of docs) {
      const sectionField = doc.section as { _id?: unknown; name?: unknown } | unknown;
      const sectionName =
        sectionField && typeof sectionField === "object" && "name" in sectionField && typeof (sectionField as { name?: unknown }).name === "string"
          ? (sectionField as { name: string }).name
          : String(doc.section);

      response[sectionName] = doc.json;
    }

    return response;
  },
};