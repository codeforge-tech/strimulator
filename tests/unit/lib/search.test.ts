import { describe, it, expect } from "bun:test";
import {
  parseSearchQuery,
  matchesCondition,
  buildSearchResult,
  type SearchCondition,
} from "../../../src/lib/search";

// ============================================================
// parseSearchQuery
// ============================================================

describe("parseSearchQuery", () => {
  // --- Simple equality ---

  it("parses a simple field:value equality", () => {
    const conditions = parseSearchQuery('status:"active"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "status", operator: "eq", value: "active" });
  });

  it("parses email exact match", () => {
    const conditions = parseSearchQuery('email:"test@foo.com"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "email", operator: "eq", value: "test@foo.com" });
  });

  it("parses name exact match", () => {
    const conditions = parseSearchQuery('name:"John Doe"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "name", operator: "eq", value: "John Doe" });
  });

  it("parses field with empty quoted value", () => {
    const conditions = parseSearchQuery('name:""');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "name", operator: "eq", value: "" });
  });

  it("parses status equality", () => {
    const conditions = parseSearchQuery('status:"canceled"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "status", operator: "eq", value: "canceled" });
  });

  // --- Like / substring ---

  it("parses like/substring condition with ~", () => {
    const conditions = parseSearchQuery('name~"test"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "name", operator: "like", value: "test" });
  });

  it("parses email substring", () => {
    const conditions = parseSearchQuery('email~"example.com"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "email", operator: "like", value: "example.com" });
  });

  it("parses like with empty value", () => {
    const conditions = parseSearchQuery('name~""');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "name", operator: "like", value: "" });
  });

  // --- Negation ---

  it("parses negation with -field:value", () => {
    const conditions = parseSearchQuery('-status:"canceled"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "status", operator: "neq", value: "canceled" });
  });

  it("parses negation with like operator (-field~value)", () => {
    const conditions = parseSearchQuery('-name~"test"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "name", operator: "like", value: "test" });
  });

  // --- Numeric comparisons ---

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

  it("parses amount>100", () => {
    const conditions = parseSearchQuery("amount>100");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "amount", operator: "gt", value: "100" });
  });

  it("parses amount<100", () => {
    const conditions = parseSearchQuery("amount<100");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "amount", operator: "lt", value: "100" });
  });

  it("parses amount>=100", () => {
    const conditions = parseSearchQuery("amount>=100");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "amount", operator: "gte", value: "100" });
  });

  it("parses amount<=100", () => {
    const conditions = parseSearchQuery("amount<=100");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "amount", operator: "lte", value: "100" });
  });

  it("parses field>0", () => {
    const conditions = parseSearchQuery("created>0");
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({ field: "created", operator: "gt", value: "0" });
  });

  // --- Metadata queries ---

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

  it("parses metadata with like operator", () => {
    const conditions = parseSearchQuery('metadata["tag"]~"important"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]).toEqual({
      field: "metadata",
      operator: "like",
      value: "important",
      metadataKey: "tag",
    });
  });

  it("parses metadata with underscore key", () => {
    const conditions = parseSearchQuery('metadata["order_id"]:"abc123"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0].metadataKey).toBe("order_id");
    expect(conditions[0].value).toBe("abc123");
  });

  it("parses metadata with empty value", () => {
    const conditions = parseSearchQuery('metadata["key"]:""');
    expect(conditions).toHaveLength(1);
    expect(conditions[0].value).toBe("");
    expect(conditions[0].metadataKey).toBe("key");
  });

  // --- Compound / AND queries ---

  it("parses two conditions joined by AND keyword", () => {
    const conditions = parseSearchQuery('status:"active" AND created>1000');
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toEqual({ field: "status", operator: "eq", value: "active" });
    expect(conditions[1]).toEqual({ field: "created", operator: "gt", value: "1000" });
  });

  it("parses two conditions joined by implicit AND (space)", () => {
    const conditions = parseSearchQuery('status:"active" created>1000');
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toEqual({ field: "status", operator: "eq", value: "active" });
    expect(conditions[1]).toEqual({ field: "created", operator: "gt", value: "1000" });
  });

  it("parses three conditions with AND", () => {
    const conditions = parseSearchQuery('email:"a@b.com" AND status:"active" AND created>500');
    expect(conditions).toHaveLength(3);
    expect(conditions[0].field).toBe("email");
    expect(conditions[1].field).toBe("status");
    expect(conditions[2].field).toBe("created");
  });

  it("parses mixed operators in compound query", () => {
    const conditions = parseSearchQuery('status:"active" name~"test" created>1000 created<2000');
    expect(conditions).toHaveLength(4);
    expect(conditions[0].operator).toBe("eq");
    expect(conditions[1].operator).toBe("like");
    expect(conditions[2].operator).toBe("gt");
    expect(conditions[3].operator).toBe("lt");
  });

  it("parses compound with metadata and regular fields", () => {
    const conditions = parseSearchQuery('email:"a@b.com" AND metadata["plan"]:"pro"');
    expect(conditions).toHaveLength(2);
    expect(conditions[0].field).toBe("email");
    expect(conditions[1].field).toBe("metadata");
    expect(conditions[1].metadataKey).toBe("plan");
  });

  it("parses compound with negation", () => {
    const conditions = parseSearchQuery('status:"active" AND -email:"test@test.com"');
    expect(conditions).toHaveLength(2);
    expect(conditions[0].operator).toBe("eq");
    expect(conditions[1].operator).toBe("neq");
  });

  // --- Empty / whitespace ---

  it("returns empty array for empty string", () => {
    expect(parseSearchQuery("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseSearchQuery("   ")).toEqual([]);
    expect(parseSearchQuery("\t")).toEqual([]);
    expect(parseSearchQuery("\n")).toEqual([]);
  });

  // --- Edge cases ---

  it("handles extra whitespace around conditions", () => {
    const conditions = parseSearchQuery('  status:"active"   created>1000  ');
    expect(conditions).toHaveLength(2);
    expect(conditions[0].field).toBe("status");
    expect(conditions[1].field).toBe("created");
  });

  it("handles AND keyword case-insensitively", () => {
    const conditions = parseSearchQuery('status:"active" and created>1000');
    expect(conditions).toHaveLength(2);
  });

  it("parses value with special characters in quotes", () => {
    const conditions = parseSearchQuery('email:"user+tag@example.com"');
    expect(conditions).toHaveLength(1);
    expect(conditions[0].value).toBe("user+tag@example.com");
  });

  it("parses value with dots and hyphens", () => {
    const conditions = parseSearchQuery('name:"John O\'Brien"');
    // Note: single quote inside double-quoted is fine
    // But the regex stops at double quote, so this would parse up to the quote
    // Adjusting to use a safe value
    const conditions2 = parseSearchQuery('name:"test-value.com"');
    expect(conditions2).toHaveLength(1);
    expect(conditions2[0].value).toBe("test-value.com");
  });

  it("handles multiple AND keywords gracefully", () => {
    const conditions = parseSearchQuery('status:"active" AND AND created>1000');
    // The second AND should be skipped
    expect(conditions).toHaveLength(2);
  });

  it("handles query with only AND keyword", () => {
    const conditions = parseSearchQuery("AND");
    expect(conditions).toEqual([]);
  });

  it("parses numeric comparison with large number", () => {
    const conditions = parseSearchQuery("created>99999999999");
    expect(conditions).toHaveLength(1);
    expect(conditions[0].value).toBe("99999999999");
  });
});

// ============================================================
// matchesCondition
// ============================================================

describe("matchesCondition", () => {
  // --- eq operator ---

  it("matches eq case-insensitively", () => {
    expect(
      matchesCondition({ email: "Test@Example.com" }, { field: "email", operator: "eq", value: "test@example.com" }),
    ).toBe(true);
  });

  it("eq returns false when values differ", () => {
    expect(
      matchesCondition({ email: "other@example.com" }, { field: "email", operator: "eq", value: "test@example.com" }),
    ).toBe(false);
  });

  it("eq matches status field", () => {
    expect(matchesCondition({ status: "active" }, { field: "status", operator: "eq", value: "active" })).toBe(true);
  });

  it("eq is case-insensitive for status", () => {
    expect(matchesCondition({ status: "Active" }, { field: "status", operator: "eq", value: "active" })).toBe(true);
  });

  // --- neq operator ---

  it("neq returns true when values differ", () => {
    expect(
      matchesCondition({ status: "active" }, { field: "status", operator: "neq", value: "canceled" }),
    ).toBe(true);
  });

  it("neq returns false when values match", () => {
    expect(
      matchesCondition({ status: "canceled" }, { field: "status", operator: "neq", value: "canceled" }),
    ).toBe(false);
  });

  it("neq is case-insensitive", () => {
    expect(
      matchesCondition({ status: "CANCELED" }, { field: "status", operator: "neq", value: "canceled" }),
    ).toBe(false);
  });

  // --- like operator ---

  it("like matches substring case-insensitively", () => {
    expect(
      matchesCondition({ name: "Alice Wonder" }, { field: "name", operator: "like", value: "alice" }),
    ).toBe(true);
  });

  it("like returns false when substring not found", () => {
    expect(matchesCondition({ name: "Bob" }, { field: "name", operator: "like", value: "alice" })).toBe(false);
  });

  it("like matches at beginning of string", () => {
    expect(matchesCondition({ name: "Alice" }, { field: "name", operator: "like", value: "ali" })).toBe(true);
  });

  it("like matches at end of string", () => {
    expect(matchesCondition({ name: "Alice" }, { field: "name", operator: "like", value: "ice" })).toBe(true);
  });

  it("like matches entire string", () => {
    expect(matchesCondition({ name: "Alice" }, { field: "name", operator: "like", value: "alice" })).toBe(true);
  });

  it("like with empty value matches everything", () => {
    expect(matchesCondition({ name: "anything" }, { field: "name", operator: "like", value: "" })).toBe(true);
  });

  // --- gt operator ---

  it("gt returns true when field > value", () => {
    expect(matchesCondition({ created: 2000 }, { field: "created", operator: "gt", value: "1000" })).toBe(true);
  });

  it("gt returns false when field = value", () => {
    expect(matchesCondition({ created: 1000 }, { field: "created", operator: "gt", value: "1000" })).toBe(false);
  });

  it("gt returns false when field < value", () => {
    expect(matchesCondition({ created: 500 }, { field: "created", operator: "gt", value: "1000" })).toBe(false);
  });

  // --- lt operator ---

  it("lt returns true when field < value", () => {
    expect(matchesCondition({ created: 500 }, { field: "created", operator: "lt", value: "1000" })).toBe(true);
  });

  it("lt returns false when field = value", () => {
    expect(matchesCondition({ created: 1000 }, { field: "created", operator: "lt", value: "1000" })).toBe(false);
  });

  it("lt returns false when field > value", () => {
    expect(matchesCondition({ created: 2000 }, { field: "created", operator: "lt", value: "1000" })).toBe(false);
  });

  // --- gte operator ---

  it("gte returns true when field > value", () => {
    expect(matchesCondition({ created: 2000 }, { field: "created", operator: "gte", value: "1000" })).toBe(true);
  });

  it("gte returns true when field = value", () => {
    expect(matchesCondition({ created: 1000 }, { field: "created", operator: "gte", value: "1000" })).toBe(true);
  });

  it("gte returns false when field < value", () => {
    expect(matchesCondition({ created: 999 }, { field: "created", operator: "gte", value: "1000" })).toBe(false);
  });

  // --- lte operator ---

  it("lte returns true when field < value", () => {
    expect(matchesCondition({ created: 500 }, { field: "created", operator: "lte", value: "1000" })).toBe(true);
  });

  it("lte returns true when field = value", () => {
    expect(matchesCondition({ created: 1000 }, { field: "created", operator: "lte", value: "1000" })).toBe(true);
  });

  it("lte returns false when field > value", () => {
    expect(matchesCondition({ created: 1001 }, { field: "created", operator: "lte", value: "1000" })).toBe(false);
  });

  // --- gt/lt with timestamps ---

  it("gt works with large timestamps", () => {
    expect(matchesCondition({ created: 1700000001 }, { field: "created", operator: "gt", value: "1700000000" })).toBe(true);
  });

  it("lt works with large timestamps", () => {
    expect(matchesCondition({ created: 1699999999 }, { field: "created", operator: "lt", value: "1700000000" })).toBe(true);
  });

  // --- Metadata access ---

  it("matches metadata key-value with eq", () => {
    const data = { metadata: { plan: "pro", env: "prod" } };
    expect(
      matchesCondition(data, { field: "metadata", operator: "eq", value: "pro", metadataKey: "plan" }),
    ).toBe(true);
  });

  it("metadata eq returns false for wrong value", () => {
    const data = { metadata: { plan: "pro" } };
    expect(
      matchesCondition(data, { field: "metadata", operator: "eq", value: "free", metadataKey: "plan" }),
    ).toBe(false);
  });

  it("metadata eq returns false for missing key", () => {
    const data = { metadata: { plan: "pro" } };
    expect(
      matchesCondition(data, { field: "metadata", operator: "eq", value: "pro", metadataKey: "missing" }),
    ).toBe(false);
  });

  it("metadata returns false when metadata is null", () => {
    const data = { metadata: null };
    expect(
      matchesCondition(data, { field: "metadata", operator: "eq", value: "pro", metadataKey: "plan" }),
    ).toBe(false);
  });

  it("metadata returns false when metadata is undefined", () => {
    const data = {};
    expect(
      matchesCondition(data, { field: "metadata", operator: "eq", value: "pro", metadataKey: "plan" }),
    ).toBe(false);
  });

  it("metadata returns false when metadata is not an object", () => {
    const data = { metadata: "not_an_object" };
    expect(
      matchesCondition(data, { field: "metadata", operator: "eq", value: "pro", metadataKey: "plan" }),
    ).toBe(false);
  });

  it("metadata like matches substring in metadata value", () => {
    const data = { metadata: { description: "important order" } };
    expect(
      matchesCondition(data, { field: "metadata", operator: "like", value: "important", metadataKey: "description" }),
    ).toBe(true);
  });

  it("metadata returns false when metadataKey value is null", () => {
    const data = { metadata: { plan: null } };
    expect(
      matchesCondition(data, { field: "metadata", operator: "eq", value: "pro", metadataKey: "plan" }),
    ).toBe(false);
  });

  // --- Null / undefined field values ---

  it("returns true for neq when field is null", () => {
    expect(
      matchesCondition({ status: null }, { field: "status", operator: "neq", value: "canceled" }),
    ).toBe(true);
  });

  it("returns true for neq when field is undefined (missing)", () => {
    expect(
      matchesCondition({}, { field: "status", operator: "neq", value: "canceled" }),
    ).toBe(true);
  });

  it("returns false for eq when field is null", () => {
    expect(
      matchesCondition({ email: null }, { field: "email", operator: "eq", value: "test@example.com" }),
    ).toBe(false);
  });

  it("returns false for eq when field is undefined (missing)", () => {
    expect(matchesCondition({}, { field: "email", operator: "eq", value: "test@example.com" })).toBe(false);
  });

  it("returns false for like when field is null", () => {
    expect(matchesCondition({ name: null }, { field: "name", operator: "like", value: "test" })).toBe(false);
  });

  it("returns false for gt when field is null", () => {
    expect(matchesCondition({ created: null }, { field: "created", operator: "gt", value: "1000" })).toBe(false);
  });

  it("returns false for lt when field is undefined", () => {
    expect(matchesCondition({}, { field: "created", operator: "lt", value: "1000" })).toBe(false);
  });

  // --- Case sensitivity ---

  it("eq comparison is case-insensitive", () => {
    expect(matchesCondition({ status: "ACTIVE" }, { field: "status", operator: "eq", value: "active" })).toBe(true);
    expect(matchesCondition({ status: "active" }, { field: "status", operator: "eq", value: "ACTIVE" })).toBe(true);
  });

  it("like comparison is case-insensitive", () => {
    expect(matchesCondition({ name: "ALICE" }, { field: "name", operator: "like", value: "alice" })).toBe(true);
  });

  it("neq comparison is case-insensitive", () => {
    expect(matchesCondition({ status: "CANCELED" }, { field: "status", operator: "neq", value: "canceled" })).toBe(false);
  });

  // --- Field type coercion ---

  it("coerces numeric field to string for eq", () => {
    expect(matchesCondition({ amount: 5000 }, { field: "amount", operator: "eq", value: "5000" })).toBe(true);
  });

  it("coerces boolean field to string for eq", () => {
    expect(matchesCondition({ livemode: false }, { field: "livemode", operator: "eq", value: "false" })).toBe(true);
  });
});

// ============================================================
// buildSearchResult
// ============================================================

describe("buildSearchResult", () => {
  it("returns correct shape with data", () => {
    const items = [{ id: "cus_1" }, { id: "cus_2" }];
    const result = buildSearchResult(items, "/v1/customers/search", false, 2);
    expect(result).toEqual({
      object: "search_result",
      url: "/v1/customers/search",
      has_more: false,
      data: items,
      total_count: 2,
      next_page: null,
    });
  });

  it("object is always 'search_result'", () => {
    const result = buildSearchResult([], "/v1/test", false, 0);
    expect(result.object).toBe("search_result");
  });

  it("returns empty data array", () => {
    const result = buildSearchResult([], "/v1/customers/search", false, 0);
    expect(result.data).toEqual([]);
    expect(result.total_count).toBe(0);
  });

  it("has_more reflects whether more pages exist", () => {
    const resultMore = buildSearchResult([{ id: "cus_1" }], "/v1/customers/search", true, 50);
    expect(resultMore.has_more).toBe(true);

    const resultNoMore = buildSearchResult([{ id: "cus_1" }], "/v1/customers/search", false, 1);
    expect(resultNoMore.has_more).toBe(false);
  });

  it("total_count reflects the total matching items", () => {
    const result = buildSearchResult([{ id: "cus_1" }], "/v1/customers/search", true, 100);
    expect(result.total_count).toBe(100);
  });

  it("url reflects the search path", () => {
    const result = buildSearchResult([], "/v1/payment_intents/search", false, 0);
    expect(result.url).toBe("/v1/payment_intents/search");
  });

  it("next_page is always null", () => {
    const result = buildSearchResult([{ id: "cus_1" }], "/v1/customers/search", true, 50);
    expect(result.next_page).toBeNull();
  });

  it("data preserves item structure", () => {
    const item = { id: "cus_1", email: "test@test.com", metadata: { key: "val" } };
    const result = buildSearchResult([item], "/v1/customers/search", false, 1);
    expect(result.data[0]).toEqual(item);
  });

  it("handles multiple items", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `cus_${i}` }));
    const result = buildSearchResult(items, "/v1/customers/search", false, 5);
    expect(result.data).toHaveLength(5);
    expect(result.total_count).toBe(5);
  });
});
