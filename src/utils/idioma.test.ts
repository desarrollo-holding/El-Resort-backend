import { parseIdiomaQuery } from "./idioma";

describe("parseIdiomaQuery", () => {
  it("accepts es/en (case-insensitive, trimmed)", () => {
    expect(parseIdiomaQuery("es")).toBe("es");
    expect(parseIdiomaQuery(" EN ")).toBe("en");
    expect(parseIdiomaQuery(["es"])).toBe("es");
  });
  it("returns null for anything else", () => {
    expect(parseIdiomaQuery("fr")).toBeNull();
    expect(parseIdiomaQuery("")).toBeNull();
    expect(parseIdiomaQuery(undefined)).toBeNull();
    expect(parseIdiomaQuery(123)).toBeNull();
  });
});
