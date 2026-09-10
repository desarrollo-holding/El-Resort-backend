import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPublicMediaRewriteEnabled, rewriteMediaUrlsInJson, toPublicMediaUrl } from "./publicMedia";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.GCS_BUCKET_RESORT = "marketing_gallery";
  process.env.MEDIA_PUBLIC_BASE_URL = "https://elresort.pe/cms";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const bucketUrl = (object: string) => `https://storage.googleapis.com/marketing_gallery/${object}`;

describe("toPublicMediaUrl", () => {
  it("reemplaza el prefijo del bucket por la base pública", () => {
    expect(toPublicMediaUrl(bucketUrl("fotosresort/123-abc/orig.webp"))).toBe(
      "https://elresort.pe/cms/fotosresort/123-abc/orig.webp"
    );
  });

  it("no toca URLs de otro origen ni rutas relativas", () => {
    expect(toPublicMediaUrl("https://hotels.cloudbeds.com/foto.jpg")).toBe("https://hotels.cloudbeds.com/foto.jpg");
    expect(toPublicMediaUrl("/videos/welcome-video.webm")).toBe("/videos/welcome-video.webm");
    expect(toPublicMediaUrl("data:image/gif;base64,R0lGOD")).toBe("data:image/gif;base64,R0lGOD");
  });

  it("no toca URLs de OTRO bucket del mismo storage", () => {
    expect(toPublicMediaUrl("https://storage.googleapis.com/otro_bucket/x.webp")).toBe(
      "https://storage.googleapis.com/otro_bucket/x.webp"
    );
  });

  it("tolera barras finales sobrantes en la variable de entorno", () => {
    process.env.MEDIA_PUBLIC_BASE_URL = "https://elresort.pe/cms///";
    expect(toPublicMediaUrl(bucketUrl("a/b.webp"))).toBe("https://elresort.pe/cms/a/b.webp");
  });
});

describe("apagado (el rollback)", () => {
  it("sin MEDIA_PUBLIC_BASE_URL devuelve todo intacto", () => {
    delete process.env.MEDIA_PUBLIC_BASE_URL;
    expect(isPublicMediaRewriteEnabled()).toBe(false);
    expect(toPublicMediaUrl(bucketUrl("a.webp"))).toBe(bucketUrl("a.webp"));
    const json = JSON.stringify({ url: bucketUrl("a.webp") });
    expect(rewriteMediaUrlsInJson(json)).toBe(json);
  });

  it("sin GCS_BUCKET_RESORT no lanza: responder no puede depender de que haya bucket", () => {
    delete process.env.GCS_BUCKET_RESORT;
    expect(isPublicMediaRewriteEnabled()).toBe(false);
    expect(() => toPublicMediaUrl(bucketUrl("a.webp"))).not.toThrow();
  });
});

describe("rewriteMediaUrlsInJson", () => {
  it("reescribe todas las apariciones, a cualquier profundidad y en arrays", () => {
    const payload = {
      portada: {
        url: bucketUrl("fotosresort/1/orig.webp"),
        variants: [
          { width: 480, url: bucketUrl("fotosresort/1/w480.webp") },
          { width: 768, url: bucketUrl("fotosresort/1/w768.webp") },
        ],
      },
      bedrooms: [{ photos: [{ url: bucketUrl("fotosresort/2/orig.webp") }] }],
      // Hoja `src` suelta del árbol libre de landingmedias
      sections: { presentationSection: { heroMobileImage: { src: bucketUrl("fotosresort/3/orig.webp") } } },
    };

    const result = JSON.parse(rewriteMediaUrlsInJson(JSON.stringify(payload)));

    expect(result.portada.url).toBe("https://elresort.pe/cms/fotosresort/1/orig.webp");
    expect(result.portada.variants.map((v: { url: string }) => v.url)).toEqual([
      "https://elresort.pe/cms/fotosresort/1/w480.webp",
      "https://elresort.pe/cms/fotosresort/1/w768.webp",
    ]);
    expect(result.bedrooms[0].photos[0].url).toBe("https://elresort.pe/cms/fotosresort/2/orig.webp");
    expect(result.sections.presentationSection.heroMobileImage.src).toBe(
      "https://elresort.pe/cms/fotosresort/3/orig.webp"
    );
  });

  it("no rompe fechas ni números al no recorrer el objeto", () => {
    // Es la razón de operar sobre el texto: un walker ingenuo convierte un Date en {}.
    const payload = { createdAt: new Date("2026-01-15T10:00:00.000Z"), precio: 250.5, activo: true, nada: null };
    const result = JSON.parse(rewriteMediaUrlsInJson(JSON.stringify(payload)));
    expect(result.createdAt).toBe("2026-01-15T10:00:00.000Z");
    expect(result.precio).toBe(250.5);
    expect(result.activo).toBe(true);
    expect(result.nada).toBeNull();
  });

  it("produce un JSON que sigue siendo válido con acentos y comillas", () => {
    const payload = { alt: 'Bungalow "río" — señalización', url: bucketUrl("a.webp") };
    const result = JSON.parse(rewriteMediaUrlsInJson(JSON.stringify(payload)));
    expect(result.alt).toBe('Bungalow "río" — señalización');
    expect(result.url).toBe("https://elresort.pe/cms/a.webp");
  });

  it("trata el nombre del bucket como texto literal, no como patrón", () => {
    // Los buckets de GCS admiten puntos. Con una regex interpolada sin escapar, el punto sería un
    // comodín y `storage.googleapis.com/mi-bucketXpe/` también coincidiría.
    process.env.GCS_BUCKET_RESORT = "mi-bucket.pe";
    const noMatch = JSON.stringify({ url: "https://storage.googleapis.com/mi-bucketXpe/a.webp" });
    expect(rewriteMediaUrlsInJson(noMatch)).toBe(noMatch);

    const match = JSON.stringify({ url: "https://storage.googleapis.com/mi-bucket.pe/a.webp" });
    expect(JSON.parse(rewriteMediaUrlsInJson(match)).url).toBe("https://elresort.pe/cms/a.webp");
  });
});
