import {
  asOptionalBoolean,
  asOptionalInt,
  asOptionalString,
  clamp,
  formatCloudbedsError,
  pickFirstQueryValue,
} from "./http";

describe("pickFirstQueryValue", () => {
  it("returns strings as-is and the first element of arrays", () => {
    expect(pickFirstQueryValue("a")).toBe("a");
    expect(pickFirstQueryValue(["a", "b"])).toBe("a");
  });
  it("returns undefined for non-string inputs", () => {
    expect(pickFirstQueryValue(undefined)).toBeUndefined();
    expect(pickFirstQueryValue(42)).toBeUndefined();
    expect(pickFirstQueryValue([1, 2])).toBeUndefined();
  });
});

describe("asOptionalString", () => {
  it("trims and drops empty values", () => {
    expect(asOptionalString("  hi ")).toBe("hi");
    expect(asOptionalString("   ")).toBeUndefined();
    expect(asOptionalString(undefined)).toBeUndefined();
  });
});

describe("asOptionalInt", () => {
  it("parses integers only", () => {
    expect(asOptionalInt("10")).toBe(10);
    expect(asOptionalInt(["3"])).toBe(3);
    expect(asOptionalInt("3.5")).toBeUndefined();
    expect(asOptionalInt("abc")).toBeUndefined();
    expect(asOptionalInt("")).toBeUndefined();
  });
});

describe("asOptionalBoolean", () => {
  it("maps common truthy/falsy strings", () => {
    expect(asOptionalBoolean("true")).toBe(true);
    expect(asOptionalBoolean("1")).toBe(true);
    expect(asOptionalBoolean("FALSE")).toBe(false);
    expect(asOptionalBoolean("0")).toBe(false);
    expect(asOptionalBoolean("maybe")).toBeUndefined();
  });
});

describe("clamp", () => {
  it("bounds a value between min and max", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("formatCloudbedsError", () => {
  it("shapes an error into the cloudbeds payload", () => {
    expect(
      formatCloudbedsError({ status: 404, message: "not found", request: { a: 1 }, responseBody: { b: 2 } })
    ).toEqual({
      provider: "cloudbeds",
      status: 404,
      message: "not found",
      request: { a: 1 },
      data: { b: 2 },
    });
  });
});
