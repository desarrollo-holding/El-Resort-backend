import { PaymentTokenService } from "./paymentToken";

describe("PaymentTokenService", () => {
  beforeAll(() => {
    process.env.PAYMENT_TOKEN_SECRET = "unit-test-secret";
    process.env.PAYMENT_TOKEN_TTL_SECONDS = "600";
  });

  it("signs and verifies a reservation token round-trip", () => {
    const token = PaymentTokenService.sign({ reservationID: "  RES-123  " });
    expect(typeof token).toBe("string");
    expect(PaymentTokenService.verify(token)).toEqual({ reservationID: "RES-123" });
  });

  it("rejects an empty reservationID", () => {
    expect(() => PaymentTokenService.sign({ reservationID: "   " })).toThrow(/reservationID/);
  });

  it("rejects an empty or tampered token", () => {
    expect(() => PaymentTokenService.verify("")).toThrow(/paymentToken/);
    expect(() => PaymentTokenService.verify("not.a.jwt")).toThrow();
  });
});
