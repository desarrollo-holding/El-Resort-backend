import crypto from "crypto";
import {
  calculateIzipayHash,
  checkIzipayHash,
  parseIzipayAnswerJson,
} from "./izipaySignature";

const KEY = "test-hmac-key";
const answer = JSON.stringify({ orderStatus: "PAID", orderId: "abc" });
const hash = crypto.createHmac("sha256", KEY).update(answer, "utf8").digest("hex");

describe("calculateIzipayHash", () => {
  it("computes a stable HMAC-SHA256 hex", () => {
    expect(calculateIzipayHash(answer, KEY)).toBe(hash);
  });
});

describe("checkIzipayHash", () => {
  it("accepts a matching hash (case-insensitive)", () => {
    expect(checkIzipayHash({ "kr-answer": answer, "kr-hash": hash }, KEY)).toBe(true);
    expect(checkIzipayHash({ "kr-answer": answer, "kr-hash": hash.toUpperCase() }, KEY)).toBe(true);
  });
  it("rejects a wrong or missing hash", () => {
    expect(checkIzipayHash({ "kr-answer": answer, "kr-hash": "deadbeef" }, KEY)).toBe(false);
    expect(checkIzipayHash({ "kr-answer": answer }, KEY)).toBe(false);
    expect(checkIzipayHash({}, KEY)).toBe(false);
  });
});

describe("parseIzipayAnswerJson", () => {
  it("parses a JSON object answer", () => {
    expect(parseIzipayAnswerJson({ "kr-answer": answer })).toEqual({
      orderStatus: "PAID",
      orderId: "abc",
    });
  });
  it("throws for missing/invalid/non-object answers", () => {
    expect(() => parseIzipayAnswerJson({})).toThrow(/kr-answer/);
    expect(() => parseIzipayAnswerJson({ "kr-answer": "{oops" })).toThrow(/JSON válido/);
    expect(() => parseIzipayAnswerJson({ "kr-answer": "[1,2]" })).toThrow(/JSON objeto/);
  });
});
