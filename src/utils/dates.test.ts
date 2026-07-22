import { getDefaultStayDates, isIsoDateYmd } from "./dates";

describe("isIsoDateYmd", () => {
  it("matches YYYY-MM-DD only", () => {
    expect(isIsoDateYmd("2026-07-22")).toBe(true);
    expect(isIsoDateYmd("2026-7-2")).toBe(false);
    expect(isIsoDateYmd("22-07-2026")).toBe(false);
    expect(isIsoDateYmd("not a date")).toBe(false);
  });
});

describe("getDefaultStayDates", () => {
  it("returns consecutive ISO days with end = start + 1", () => {
    const { startDate, endDate } = getDefaultStayDates({ zone: "America/Lima" });
    expect(isIsoDateYmd(startDate)).toBe(true);
    expect(isIsoDateYmd(endDate)).toBe(true);
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(1);
  });

  it("honors month/day offsets", () => {
    const base = getDefaultStayDates({ zone: "America/Lima" });
    const shifted = getDefaultStayDates({ zone: "America/Lima", offsetDays: 2 });
    expect(shifted.startDate > base.startDate).toBe(true);
  });
});
