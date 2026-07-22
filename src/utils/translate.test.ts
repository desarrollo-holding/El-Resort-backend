import {
  asNonEmptyTrimmedString,
  asNonEmptyTrimmedStringArray,
  stringifyJsonForModel,
} from "./translate";

describe("asNonEmptyTrimmedString", () => {
  it("trims and drops empties/non-strings", () => {
    expect(asNonEmptyTrimmedString(" hi ")).toBe("hi");
    expect(asNonEmptyTrimmedString("   ")).toBeUndefined();
    expect(asNonEmptyTrimmedString(5)).toBeUndefined();
  });
});

describe("asNonEmptyTrimmedStringArray", () => {
  it("keeps only non-empty trimmed strings", () => {
    expect(asNonEmptyTrimmedStringArray([" a ", "", "b", 3])).toEqual(["a", "b"]);
    expect(asNonEmptyTrimmedStringArray([" ", ""])).toBeUndefined();
    expect(asNonEmptyTrimmedStringArray("nope")).toBeUndefined();
  });
});

describe("stringifyJsonForModel", () => {
  it("serializes plain objects", () => {
    expect(stringifyJsonForModel({ a: 1 })).toBe('{"a":1}');
  });
});
