import { describe, it, expect } from "vitest";
import {
  contentTypeByExtension,
  extensionOf,
  isGenericContentType,
  resolveStoredContentType,
  storedContentTypeNeedsFix,
} from "./mediaContentType";

describe("resolveStoredContentType", () => {
  it("usa la extensión cuando el navegador no declaró nada (Windows sin la extensión asociada)", () => {
    expect(resolveStoredContentType("tour.mp4", "")).toBe("video/mp4");
    expect(resolveStoredContentType("tour.webm", "application/octet-stream")).toBe("video/webm");
    expect(resolveStoredContentType("tour.MOV", undefined)).toBe("video/quicktime");
  });

  it("respeta el tipo del cliente cuando es de la misma familia que la extensión", () => {
    expect(resolveStoredContentType("tour.mov", "video/quicktime")).toBe("video/quicktime");
    // `.m4v` mapea a video/mp4, pero si el navegador dijo el tipo específico se conserva.
    expect(resolveStoredContentType("tour.m4v", "video/x-m4v")).toBe("video/x-m4v");
  });

  it("descarta el tipo del cliente cuando es de otra familia que la extensión", () => {
    expect(resolveStoredContentType("tour.mp4", "application/x-mp4")).toBe("video/mp4");
    expect(resolveStoredContentType("tour.mp4", "text/plain")).toBe("video/mp4");
  });

  it("no inventa un tipo cuando la extensión es desconocida", () => {
    expect(resolveStoredContentType("archivo.raro", "")).toBe("application/octet-stream");
    expect(resolveStoredContentType("archivo.raro", "application/zip")).toBe("application/zip");
    expect(resolveStoredContentType("sin-extension", "")).toBe("application/octet-stream");
  });
});

describe("extensionOf", () => {
  it("ignora query y fragmento, y toma solo el último segmento", () => {
    expect(extensionOf("videos/123_tour.mp4?generation=1")).toBe("mp4");
    expect(extensionOf("https://x/y/z.WEBM#t=2")).toBe("webm");
    expect(extensionOf("carpeta.mp4/archivo")).toBe("");
    expect(extensionOf("termina.en.punto.")).toBe("");
  });
});

describe("isGenericContentType / contentTypeByExtension", () => {
  it("reconoce los tipos que el cliente manda cuando no sabe", () => {
    expect(isGenericContentType("")).toBe(true);
    expect(isGenericContentType("  APPLICATION/OCTET-STREAM ")).toBe(true);
    expect(isGenericContentType("binary/octet-stream")).toBe(true);
    expect(isGenericContentType("video/mp4")).toBe(false);
  });

  it("devuelve null para una extensión que no conoce", () => {
    expect(contentTypeByExtension("x.mp4")).toBe("video/mp4");
    expect(contentTypeByExtension("x.zip")).toBeNull();
  });
});

describe("storedContentTypeNeedsFix", () => {
  it("marca el vídeo publicado como octet-stream, que es el que no se reproduce", () => {
    expect(storedContentTypeNeedsFix("videos/1_tour.mp4", "application/octet-stream")).toBe("video/mp4");
    expect(storedContentTypeNeedsFix("videos/1_tour.webm", "")).toBe("video/webm");
  });

  it("deja en paz lo que ya está bien", () => {
    expect(storedContentTypeNeedsFix("videos/1_tour.mp4", "video/mp4")).toBeNull();
    // Misma familia pero más específico: lo que hay sirve, no hay motivo para pisarlo.
    expect(storedContentTypeNeedsFix("videos/1_tour.m4v", "video/x-m4v")).toBeNull();
    // Parámetros del tipo no cuentan como diferencia.
    expect(storedContentTypeNeedsFix("files/1_datos.csv", "text/csv; charset=utf-8")).toBeNull();
  });

  it("no opina sobre objetos cuya extensión no conoce", () => {
    expect(storedContentTypeNeedsFix("files/1_backup.zip", "application/octet-stream")).toBeNull();
    expect(storedContentTypeNeedsFix("files/1_sin_extension", "")).toBeNull();
  });
});
