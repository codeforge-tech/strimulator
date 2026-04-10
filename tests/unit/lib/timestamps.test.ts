import { describe, it, expect } from "bun:test";
import { now, fromDate, toDate } from "../../../src/lib/timestamps";

describe("now", () => {
  it("returns current unix time in seconds", () => {
    const t = now();
    const expected = Math.floor(Date.now() / 1000);
    // Allow 1 second tolerance for timing
    expect(Math.abs(t - expected)).toBeLessThanOrEqual(1);
  });

  it("returns an integer (not a float)", () => {
    const t = now();
    expect(Number.isInteger(t)).toBe(true);
  });

  it("is close to Date.now()/1000", () => {
    const t = now();
    const jsNow = Date.now() / 1000;
    expect(Math.abs(t - jsNow)).toBeLessThan(2);
  });

  it("multiple calls return increasing or equal values", () => {
    const t1 = now();
    const t2 = now();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it("value is a reasonable timestamp (after 2024)", () => {
    const t = now();
    const jan2024 = Math.floor(new Date("2024-01-01").getTime() / 1000);
    expect(t).toBeGreaterThan(jan2024);
  });

  it("value is a positive number", () => {
    expect(now()).toBeGreaterThan(0);
  });
});

describe("fromDate", () => {
  it("converts a Date to unix timestamp in seconds", () => {
    const date = new Date("2024-06-15T12:00:00Z");
    const ts = fromDate(date);
    expect(ts).toBe(Math.floor(date.getTime() / 1000));
  });

  it("returns integer for arbitrary dates", () => {
    const date = new Date("2023-01-01T00:00:00.500Z");
    const ts = fromDate(date);
    expect(Number.isInteger(ts)).toBe(true);
  });

  it("floors milliseconds", () => {
    const date = new Date("2024-01-01T00:00:00.999Z");
    const ts = fromDate(date);
    const expected = Math.floor(date.getTime() / 1000);
    expect(ts).toBe(expected);
  });

  it("handles epoch", () => {
    const ts = fromDate(new Date(0));
    expect(ts).toBe(0);
  });
});

describe("toDate", () => {
  it("converts a unix timestamp to a Date", () => {
    const ts = 1700000000;
    const date = toDate(ts);
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBe(ts * 1000);
  });

  it("roundtrips with fromDate", () => {
    const original = new Date("2024-06-15T12:00:00Z");
    const ts = fromDate(original);
    const roundtripped = toDate(ts);
    // Should be within 1 second (due to flooring)
    expect(Math.abs(roundtripped.getTime() - original.getTime())).toBeLessThan(1000);
  });

  it("handles epoch timestamp", () => {
    const date = toDate(0);
    expect(date.getTime()).toBe(0);
  });
});
