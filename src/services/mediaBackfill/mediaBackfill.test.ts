import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectMediaRefs } from "./mediaRefs";
import { COLLECTION_RULES, modeFor, normalizePathPattern } from "./collections";
import { buildSet, type StoredResult } from "./runner";
import type { PendingItem } from "./inventory";

const BUCKET = "greendreams_bucket";
const bucketUrl = (object: string) => `https://storage.googleapis.com/${BUCKET}/${object}`;

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.GCS_BUCKET_RESORT = BUCKET;
  // Ver el comentario equivalente en csStorage.service.test.ts.
  process.env.GCS_BUCKET_RESORT_OVERRIDE = "1";
  process.env.GOOGLE_CLOUD_STORAGE_CREDENTIALS = JSON.stringify({ project_id: "x" });
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("collectMediaRefs", () => {
  it("clasifica por storagePrefix y no por variants.length", () => {
    // Una imagen más angosta que el candidato menor (480 px) pasa por todo el pipeline y queda con
    // `variants: []`. Si la marca fuera `variants.length > 0` se volvería a migrar en CADA corrida.
    const doc = {
      portada: {
        url: bucketUrl("fotosresort/1-a/orig.webp"),
        storageKey: "fotosresort/1-a/orig.webp",
        storagePrefix: "fotosresort/1-a",
        width: 400,
        height: 300,
        variants: [],
      },
    };
    const refs = collectMediaRefs(doc, BUCKET);
    expect(refs).toHaveLength(1);
    expect(refs[0].classification).toBe("migrada");
  });

  it("detecta una reversión: hay prefijo pero la URL ya no apunta al orig.webp", () => {
    const doc = {
      portada: {
        url: bucketUrl("fotosresort/original.jpg"),
        storageKey: "fotosresort/original.jpg",
        storagePrefix: "fotosresort/1-a",
        variants: [],
      },
    };
    expect(collectMediaRefs(doc, BUCKET)[0].classification).toBe("revertida");
  });

  it("no emite las URLs de dentro de variants[]: son el resultado, no ubicaciones a migrar", () => {
    const doc = {
      portada: {
        url: bucketUrl("fotosresort/1-a/orig.webp"),
        storageKey: "fotosresort/1-a/orig.webp",
        storagePrefix: "fotosresort/1-a",
        variants: [
          { width: 480, height: 270, format: "webp", url: bucketUrl("fotosresort/1-a/w480.webp") },
          { width: 768, height: 432, format: "webp", url: bucketUrl("fotosresort/1-a/w768.webp") },
        ],
      },
    };
    expect(collectMediaRefs(doc, BUCKET)).toHaveLength(1);
  });

  it("IDEMPOTENCIA: no vuelve a emitir lo que el propio backfill escribió", () => {
    // El caso que se escapó en la primera corrida real: `legacyUrl` guarda la URL del ORIGINAL, que
    // por definición es una imagen del bucket sin migrar. Sin excluirla, la corrida siguiente
    // "migraría" los punteros de reversión y destruiría la única forma de volver atrás.
    const doc = {
      portada: {
        url: bucketUrl("fotosresort/999-uuid/orig.webp"),
        storageKey: "fotosresort/999-uuid/orig.webp",
        storagePrefix: "fotosresort/999-uuid",
        width: 2400,
        height: 1350,
        variants: [{ width: 480, height: 270, format: "webp", url: bucketUrl("fotosresort/999-uuid/w480.webp") }],
        legacyUrl: bucketUrl("fotosresort/1788798531335_gimnasio.webp"),
        legacyStorageKey: "fotosresort/1788798531335_gimnasio.webp",
      },
    };
    const refs = collectMediaRefs(doc, BUCKET);
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("portada");
    expect(refs[0].classification).toBe("migrada");
    expect(refs.some((r) => r.path.includes("legacy"))).toBe(false);
  });

  it("un documento ya migrado no produce NINGUNA ubicación pendiente", () => {
    const doc = {
      imagenes: [
        {
          url: bucketUrl("fotosresort/a/orig.webp"),
          storageKey: "fotosresort/a/orig.webp",
          storagePrefix: "fotosresort/a",
          variants: [],
          legacyUrl: bucketUrl("fotosresort/original-1.jpg"),
          legacyStorageKey: "fotosresort/original-1.jpg",
        },
      ],
      json: {
        hero: {
          src: bucketUrl("fotosresort/b/orig.webp"),
          storageKey: "fotosresort/b/orig.webp",
          storagePrefix: "fotosresort/b",
          variants: [{ width: 480, height: 270, format: "webp", url: bucketUrl("fotosresort/b/w480.webp") }],
          legacyUrl: bucketUrl("files/original-2.png"),
          legacyStorageKey: "files/original-2.png",
        },
      },
    };
    expect(collectMediaRefs(doc, BUCKET).map((r) => r.classification)).toEqual(["migrada", "migrada"]);
  });

  it("emite el contenedor una sola vez y no también su string interno", () => {
    // Contarlos dos veces haría que el backfill procesara la misma imagen dos veces, y la segunda
    // escribiría en una ruta que ya no existe.
    const doc = { portada: { url: bucketUrl("fotosresort/a.jpg") } };
    const refs = collectMediaRefs(doc, BUCKET);
    expect(refs).toHaveLength(1);
    expect(refs[0].shape).toBe("asset");
    expect(refs[0].path).toBe("portada");
  });

  it("reconoce la hoja del árbol de landingmedias, con la URL en `src`", () => {
    const doc = {
      json: { carouselImages: [{ src: bucketUrl("files/carrusel.jpg"), sortIndex: 0, kind: "image" }] },
    };
    const refs = collectMediaRefs(doc, BUCKET);
    expect(refs).toHaveLength(1);
    expect(refs[0].shape).toBe("leaf");
    expect(refs[0].path).toBe("json.carouselImages.0");
    expect(refs[0].classification).toBe("pendiente");
  });

  it("promueve un string suelto de un array a ubicación pendiente", () => {
    const doc = { imagenes: [bucketUrl("fotosresort/gimnasio.webp")] };
    const refs = collectMediaRefs(doc, BUCKET);
    expect(refs[0].shape).toBe("string");
    expect(refs[0].path).toBe("imagenes.0");
    expect(refs[0].classification).toBe("pendiente");
  });

  it("salta vídeos y medios externos", () => {
    const doc = {
      video: bucketUrl("videos/clip.mp4"),
      // Un objeto con `url`/`src` es inequívocamente una referencia de medio, así que se emite
      // clasificada `externa` y el inventario la puede contar.
      cloudbedsObjeto: { url: "https://hotels.cloudbeds.com/foto.jpg" },
      // Un STRING suelto que no es del bucket ni un vídeo no se emite en absoluto: en un campo de
      // texto cualquiera no hay forma de distinguir la URL de un medio de cualquier otra URL, y
      // emitirlas llenaría el inventario de ruido. Lo que importa es que ninguna de las dos formas
      // pueda terminar clasificada `pendiente`, que es lo único que dispara una escritura.
      cloudbedsString: "https://hotels.cloudbeds.com/foto.jpg",
      local: "src/assets/images/landing/x.webp",
    };
    const byPath = new Map(collectMediaRefs(doc, BUCKET).map((r) => [r.path, r.classification]));

    expect(byPath.get("video")).toBe("video");
    expect(byPath.get("cloudbedsObjeto")).toBe("externa");
    expect(byPath.has("cloudbedsString")).toBe(false);
    expect(byPath.has("local")).toBe(false);
    expect([...byPath.values()]).not.toContain("pendiente");
  });

  it("no intenta migrar un SVG: recodificarlo perdería la escala vectorial", () => {
    const doc = { iconUrl: bucketUrl("fotosresort/frigobar.svg") };
    expect(collectMediaRefs(doc, BUCKET)).toHaveLength(0);
  });

  it("no confunde un ObjectId ni una fecha con un contenedor de medios", () => {
    const doc = {
      _id: { _bsontype: "ObjectID", id: Buffer.from("x") },
      createdAt: new Date("2026-01-01"),
      portada: { url: bucketUrl("fotosresort/a.jpg") },
    };
    expect(collectMediaRefs(doc, BUCKET)).toHaveLength(1);
  });
});

describe("modo de escritura por campo", () => {
  const ruleFor = (name: string) => COLLECTION_RULES.find((r) => r.collection === name)!;

  it("portada_video va en url-only: es String en el esquema aunque guarde un .jpg", () => {
    // RoomTypeLocalSpecs.ts:93-94. Escribir un objeto ahí se guardaría como "[object Object]".
    const ref = { path: "portada_video", shape: "string" as const, classification: "pendiente" as const, url: "x" };
    expect(modeFor(ruleFor("roomtypelocalspecs"), ref)).toBe("url-only");
  });

  it("los campos Mixed de roomtypelocalspecs van en asset", () => {
    for (const path of ["portada", "portadaMenu", "extraGalleryImages.3", "bedrooms.1.photos.0"]) {
      const ref = { path, shape: "asset" as const, classification: "pendiente" as const, url: "x" };
      expect(modeFor(ruleFor("roomtypelocalspecs"), ref), path).toBe("asset");
    }
  });

  it("condominios.mapUrl va en url-only", () => {
    const ref = { path: "mapUrl", shape: "string" as const, classification: "pendiente" as const, url: "x" };
    expect(modeFor(ruleFor("condominios"), ref)).toBe("url-only");
  });

  it("normaliza los índices de array para que una regla cubra todo el array", () => {
    expect(normalizePathPattern("imagenes.12.url")).toBe("imagenes.#.url");
    expect(normalizePathPattern("bedrooms.0.photos.3")).toBe("bedrooms.#.photos.#");
    expect(normalizePathPattern("json.carouselImages.7")).toBe("json.carouselImages.#");
    // Un segmento que solo contiene dígitos como nombre de propiedad real se normaliza igual; no
    // hay ninguno en este esquema y el falso positivo sería inocuo.
    expect(normalizePathPattern("portada")).toBe("portada");
  });
});

describe("buildSet", () => {
  const stored: StoredResult = {
    storagePrefix: "fotosresort/999-uuid",
    storageKey: "fotosresort/999-uuid/orig.webp",
    url: bucketUrl("fotosresort/999-uuid/orig.webp"),
    width: 2400,
    height: 1350,
    variants: [{ width: 480, height: 270, format: "webp", url: bucketUrl("fotosresort/999-uuid/w480.webp") }],
    bytesOrig: 800,
    bytesSmallest: 120,
    bytesStored: 1400,
  };

  const item = (over: Partial<PendingItem>): PendingItem => ({
    collection: "x",
    docId: "000000000000000000000000",
    path: "portada",
    pathPattern: "portada",
    mode: "asset",
    shape: "asset",
    url: bucketUrl("fotosresort/original.jpg"),
    ...over,
  });

  it("en url-only escribe SOLO la cadena", () => {
    const set = buildSet(item({ mode: "url-only", path: "mapUrl", shape: "string" }), stored, "loquesea");
    expect(set).toEqual({ mapUrl: stored.url });
  });

  it("en asset escribe el juego completo con los punteros legacy", () => {
    const set = buildSet(item({}), stored, { url: bucketUrl("fotosresort/original.jpg") }) as Record<string, any>;
    expect(set.portada.url).toBe(stored.url);
    expect(set.portada.storagePrefix).toBe(stored.storagePrefix);
    expect(set.portada.width).toBe(2400);
    expect(set.portada.variants).toHaveLength(1);
    expect(set.portada.legacyUrl).toBe(bucketUrl("fotosresort/original.jpg"));
    expect(set.portada.legacyStorageKey).toBe("fotosresort/original.jpg");
  });

  it("conserva las claves que la hoja de landingmedias ya tenía", () => {
    // Perder `sortIndex`/`desktop_coordinates` rompería el orden y el encuadre del carrusel.
    const prior = {
      src: bucketUrl("files/carrusel.jpg"),
      sortIndex: 3,
      desktop_coordinates: "0,0,399,500",
      mobile_coordinates: "0,0,399,500",
      kind: "image",
      status: "existing",
    };
    const set = buildSet(
      item({ path: "json.carouselImages.3", shape: "leaf", url: prior.src }),
      stored,
      prior
    ) as Record<string, any>;
    const leaf = set["json.carouselImages.3"];

    expect(leaf.src).toBe(stored.url);
    expect(leaf.sortIndex).toBe(3);
    expect(leaf.desktop_coordinates).toBe("0,0,399,500");
    expect(leaf.kind).toBe("image");
    expect(leaf.status).toBe("existing");
    // La hoja se lee por `src`: dejar además un `url` sería tener dos fuentes de verdad.
    expect(leaf.url).toBeUndefined();
    expect(leaf.legacyUrl).toBe(prior.src);
  });

  it("promueve un string suelto a objeto sin arrastrar basura", () => {
    const set = buildSet(
      item({ path: "imagenes.2", shape: "string" }),
      stored,
      bucketUrl("fotosresort/original.jpg")
    ) as Record<string, any>;
    const asset = set["imagenes.2"];
    expect(asset.url).toBe(stored.url);
    expect(asset.storagePrefix).toBe(stored.storagePrefix);
    expect(asset.variants).toHaveLength(1);
  });
});
