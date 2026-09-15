import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { publicContentCache, CONTENT_CACHE_HEADER } from "./publicContentCache";

/**
 * El caso que motiva estos tests se detectó levantando el servidor de verdad: con Mongo caído,
 * `GET /api/reviews` devolvía `503` **acompañado de `s-maxage=600`**, o sea que un CDN habría
 * servido ese error a todos los visitantes durante 10 minutos aunque la base se recuperara en
 * segundos. La cabecera se fija antes de que corra el handler, así que hay que retirarla cuando el
 * status definitivo no es 2xx.
 */

type MockRes = Response & { headers: Record<string, string>; statusCode: number };

function makeReq(overrides: Partial<Request> = {}): Request {
  return { method: "GET", headers: {}, ...overrides } as Request;
}

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    statusCode: 200,
    set(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    writeHead(..._args: unknown[]) {
      return res;
    },
  } as unknown as MockRes;
  return res;
}

/** Simula el final del ciclo de Express: fija el status y dispara `writeHead`. */
function finish(res: MockRes, status: number) {
  res.statusCode = status;
  (res.writeHead as unknown as (s: number) => void)(status);
}

describe("publicContentCache", () => {
  it("cachea un GET anónimo que termina en 200", () => {
    const res = makeRes();
    const next = vi.fn();

    publicContentCache(CONTENT_CACHE_HEADER)(makeReq(), res, next);
    finish(res, 200);

    expect(res.headers["Cache-Control"]).toBe(CONTENT_CACHE_HEADER);
    expect(next).toHaveBeenCalled();
  });

  it("NO cachea una respuesta 503 (base de datos caída)", () => {
    const res = makeRes();

    publicContentCache(CONTENT_CACHE_HEADER)(makeReq(), res, vi.fn());
    finish(res, 503);

    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("NO cachea una respuesta 404 ni una 400", () => {
    for (const status of [400, 404, 500, 502]) {
      const res = makeRes();
      publicContentCache(CONTENT_CACHE_HEADER)(makeReq(), res, vi.fn());
      finish(res, status);
      expect(res.headers["Cache-Control"]).toBe("private, no-store");
    }
  });

  it("marca no-store cuando el request trae Authorization (dashboard)", () => {
    const res = makeRes();

    publicContentCache(CONTENT_CACHE_HEADER)(
      makeReq({ headers: { authorization: "Bearer x" } as Request["headers"] }),
      res,
      vi.fn()
    );

    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("no toca las cabeceras en métodos que no son GET/HEAD", () => {
    const res = makeRes();
    const next = vi.fn();

    publicContentCache(CONTENT_CACHE_HEADER)(makeReq({ method: "POST" }), res, next);

    expect(res.headers["Cache-Control"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("respeta el status pasado como argumento a writeHead", () => {
    const res = makeRes();

    publicContentCache(CONTENT_CACHE_HEADER)(makeReq(), res, vi.fn());
    // Express puede llamar writeHead(status) sin haber tocado res.statusCode antes.
    (res.writeHead as unknown as (s: number) => void)(500);

    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });
});
