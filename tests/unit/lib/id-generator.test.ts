import { describe, test, expect } from "bun:test";
import { generateId, ID_PREFIXES } from "../../../src/lib/id-generator";

describe("generateId", () => {
  test("generates customer ID with cus_ prefix", () => {
    const id = generateId("customer");
    expect(id).toMatch(/^cus_[a-zA-Z0-9_-]{14}$/);
  });

  test("generates payment_intent ID with pi_ prefix", () => {
    const id = generateId("payment_intent");
    expect(id).toMatch(/^pi_[a-zA-Z0-9_-]{14}$/);
  });

  test("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("customer")));
    expect(ids.size).toBe(100);
  });

  test("all resource types have prefixes", () => {
    const types = Object.keys(ID_PREFIXES) as (keyof typeof ID_PREFIXES)[];
    for (const type of types) {
      const id = generateId(type);
      expect(id).toContain("_");
      expect(id.length).toBeGreaterThan(3);
    }
  });
});
