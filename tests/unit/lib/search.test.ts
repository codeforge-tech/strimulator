import { describe, it, expect } from "bun:test";
import { parseSearchQuery, matchesCondition } from "../../../src/lib/search";

describe("parseSearchQuery", () => {
  it("parses a simple email exact match", () => {
    const conditions = parseSearchQuery('email:"test@foo.com"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({
      field: "email",
      operator: "eq",
      value: "test@foo.com",
    });
  });

  it("parses status AND created with explicit AND", () => {
    const conditions = parseSearchQuery('status:"active" AND created>1000');
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toEqual({ field: "status", operator: "eq", value: "active" });
    expect(conditions[1]).toEqual({ field: "created", operator: "gt", value: "1000" });
  });

  it("parses status AND created with implicit AND (space)", () => {
    const conditions = parseSearchQuery('status:"active" created>1000');
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toEqual({ field: "status", operator: "eq", value: "active" });
    expect(conditions[1]).toEqual({ field: "created", operator: "gt", value: "1000" });
  });

  it("parses metadata[key]:value condition", () => {
    const conditions = parseSearchQuery('metadata["plan"]:"pro"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({
      field: "metadata",
      operator: "eq",
      value: "pro",
      metadataKey: "plan",
    });
  });

  it("parses negation condition", () => {
    const conditions = parseSearchQuery('-status:"canceled"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({
      field: "status",
      operator: "neq",
      value: "canceled",
    });
  });

  it("parses like/substring condition", () => {
    const conditions = parseSearchQuery('name~"test"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({
      field: "name",
      operator: "like",
      value: "test",
    });
  });

  it("parses created>N (gt)", () => {
    const conditions = parseSearchQuery("created>1234567890");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "created", operator: "gt", value: "1234567890" });
  });

  it("parses created<N (lt)", () => {
    const conditions = parseSearchQuery("created<9999999999");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "created", operator: "lt", value: "9999999999" });
  });

  it("parses created>=N (gte)", () => {
    const conditions = parseSearchQuery("created>=1000");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "created", operator: "gte", value: "1000" });
  });

  it("parses created<=N (lte)", () => {
    const conditions = parseSearchQuery("created<=2000");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "created", operator: "lte", value: "2000" });
  });

  it("returns empty array for empty string", () => {
    expect(parseSearchQuery("")).toEqual([]);
    expect(parseSearchQuery("   ")).toEqual([]);
  });

  it("parses multiple conditions joined by AND keyword", () => {
    const conditions = parseSearchQuery('email:"a@b.com" AND status:"active" AND created>500');
    expect(conditions).toHaveLength(3);
  });
});

describe("matchesCondition", () => {
  it("matches eq case-insensitively", () => {
    expect(matchesCondition({ email: "Test@Example.com" }, { field: "email", operator: "eq", value: "test@example.com" })).toBe(true);
    expect(matchesCondition({ email: "other@example.com" }, { field: "email", operator: "eq", value: "test@example.com" })).toBe(false);
  });

  it("matches like (substring, case-insensitive)", () => {
    expect(matchesCondition({ name: "Alice Wonder" }, { field: "name", operator: "like", value: "alice" })).toBe(true);
    expect(matchesCondition({ name: "Bob" }, { field: "name", operator: "like", value: "alice" })).toBe(false);
  });

  it("matches neq", () => {
    expect(matchesCondition({ status: "active" }, { field: "status", operator: "neq", value: "canceled" })).toBe(true);
    expect(matchesCondition({ status: "canceled" }, { field: "status", operator: "neq", value: "canceled" })).toBe(false);
  });

  it("matches gt numeric", () => {
    expect(matchesCondition({ created: 2000 }, { field: "created", operator: "gt", value: "1000" })).toBe(true);
    expect(matchesCondition({ created: 500 }, { field: "created", operator: "gt", value: "1000" })).toBe(false);
  });

  it("matches lt numeric", () => {
    expect(matchesCondition({ created: 500 }, { field: "created", operator: "lt", value: "1000" })).toBe(true);
    expect(matchesCondition({ created: 2000 }, { field: "created", operator: "lt", value: "1000" })).toBe(false);
  });

  it("matches gte numeric", () => {
    expect(matchesCondition({ created: 1000 }, { field: "created", operator: "gte", value: "1000" })).toBe(true);
    expect(matchesCondition({ created: 999 }, { field: "created", operator: "gte", value: "1000" })).toBe(false);
  });

  it("matches lte numeric", () => {
    expect(matchesCondition({ created: 1000 }, { field: "created", operator: "lte", value: "1000" })).toBe(true);
    expect(matchesCondition({ created: 1001 }, { field: "created", operator: "lte", value: "1000" })).toBe(false);
  });

  it("matches metadata key-value", () => {
    const data = { metadata: { plan: "pro", env: "prod" } };
    expect(matchesCondition(data, { field: "metadata", operator: "eq", value: "pro", metadataKey: "plan" })).toBe(true);
    expect(matchesCondition(data, { field: "metadata", operator: "eq", value: "free", metadataKey: "plan" })).toBe(false);
    expect(matchesCondition(data, { field: "metadata", operator: "eq", value: "pro", metadataKey: "missing" })).toBe(false);
  });

  it("returns true for neq when field is null/undefined", () => {
    expect(matchesCondition({ status: null }, { field: "status", operator: "neq", value: "canceled" })).toBe(true);
    expect(matchesCondition({}, { field: "status", operator: "neq", value: "canceled" })).toBe(true);
  });

  it("returns false for eq when field is null/undefined", () => {
    expect(matchesCondition({ email: null }, { field: "email", operator: "eq", value: "test@example.com" })).toBe(false);
    expect(matchesCondition({}, { field: "email", operator: "eq", value: "test@example.com" })).toBe(false);
  });
});
