import { describe, it, expect } from "bun:test";
import { buildListResponse, parseListParams } from "../../../src/lib/pagination";

describe("parseListParams", () => {
  it("returns defaults when no params provided", () => {
    const params = parseListParams({});
    expect(params).toEqual({ limit: 10, startingAfter: undefined, endingBefore: undefined });
  });

  it("default limit is 10", () => {
    expect(parseListParams({}).limit).toBe(10);
  });

  it("parses explicit limit", () => {
    expect(parseListParams({ limit: "25" }).limit).toBe(25);
  });

  it("parses limit=1", () => {
    expect(parseListParams({ limit: "1" }).limit).toBe(1);
  });

  it("parses limit=100", () => {
    expect(parseListParams({ limit: "100" }).limit).toBe(100);
  });

  it("caps limit at 100 when exceeding", () => {
    expect(parseListParams({ limit: "200" }).limit).toBe(100);
    expect(parseListParams({ limit: "101" }).limit).toBe(100);
    expect(parseListParams({ limit: "999" }).limit).toBe(100);
  });

  it("sets limit to 1 when limit is 0", () => {
    expect(parseListParams({ limit: "0" }).limit).toBe(1);
  });

  it("sets limit to 1 when limit is negative", () => {
    expect(parseListParams({ limit: "-5" }).limit).toBe(1);
    expect(parseListParams({ limit: "-1" }).limit).toBe(1);
    expect(parseListParams({ limit: "-100" }).limit).toBe(1);
  });

  it("sets limit to 1 when limit is NaN", () => {
    expect(parseListParams({ limit: "abc" }).limit).toBe(1);
    expect(parseListParams({ limit: "" }).limit).toBe(1);
    expect(parseListParams({ limit: "not_a_number" }).limit).toBe(1);
  });

  it("parses starting_after", () => {
    const params = parseListParams({ starting_after: "cus_abc123" });
    expect(params.startingAfter).toBe("cus_abc123");
    expect(params.endingBefore).toBeUndefined();
  });

  it("parses ending_before", () => {
    const params = parseListParams({ ending_before: "cus_xyz789" });
    expect(params.endingBefore).toBe("cus_xyz789");
    expect(params.startingAfter).toBeUndefined();
  });

  it("parses both starting_after and ending_before", () => {
    const params = parseListParams({ starting_after: "cus_a", ending_before: "cus_z" });
    expect(params.startingAfter).toBe("cus_a");
    expect(params.endingBefore).toBe("cus_z");
  });

  it("parses all params together", () => {
    const params = parseListParams({
      limit: "25",
      starting_after: "cus_abc123",
      ending_before: "cus_xyz789",
    });
    expect(params).toEqual({
      limit: 25,
      startingAfter: "cus_abc123",
      endingBefore: "cus_xyz789",
    });
  });

  it("ignores unrelated query params", () => {
    const params = parseListParams({ limit: "5", foo: "bar", baz: "qux" } as any);
    expect(params.limit).toBe(5);
    expect(params.startingAfter).toBeUndefined();
  });

  it("starting_after undefined when not provided", () => {
    const params = parseListParams({});
    expect(params.startingAfter).toBeUndefined();
  });

  it("ending_before undefined when not provided", () => {
    const params = parseListParams({});
    expect(params.endingBefore).toBeUndefined();
  });

  it("handles limit as float string (truncated to integer)", () => {
    expect(parseListParams({ limit: "10.7" }).limit).toBe(10);
    expect(parseListParams({ limit: "1.1" }).limit).toBe(1);
  });

  it("handles undefined limit gracefully", () => {
    const params = parseListParams({ limit: undefined });
    expect(params.limit).toBe(10);
  });

  it("parses limit=50", () => {
    expect(parseListParams({ limit: "50" }).limit).toBe(50);
  });

  it("parses limit=99", () => {
    expect(parseListParams({ limit: "99" }).limit).toBe(99);
  });

  it("parses limit=2", () => {
    expect(parseListParams({ limit: "2" }).limit).toBe(2);
  });
});

describe("buildListResponse", () => {
  it("wraps items in Stripe list envelope", () => {
    const items = [{ id: "cus_1" }, { id: "cus_2" }];
    const result = buildListResponse(items, "/v1/customers", false);
    expect(result).toEqual({
      object: "list",
      data: [{ id: "cus_1" }, { id: "cus_2" }],
      has_more: false,
      url: "/v1/customers",
    });
  });

  it("object is always 'list'", () => {
    const result = buildListResponse([], "/v1/test", false);
    expect(result.object).toBe("list");
  });

  it("returns empty data array", () => {
    const result = buildListResponse([], "/v1/customers", false);
    expect(result.data).toEqual([]);
    expect(result.data.length).toBe(0);
  });

  it("has_more=true when more items exist", () => {
    const result = buildListResponse([{ id: "cus_1" }], "/v1/customers", true);
    expect(result.has_more).toBe(true);
  });

  it("has_more=false when no more items", () => {
    const result = buildListResponse([{ id: "cus_1" }], "/v1/customers", false);
    expect(result.has_more).toBe(false);
  });

  it("url reflects the resource path", () => {
    const result = buildListResponse([], "/v1/payment_intents", false);
    expect(result.url).toBe("/v1/payment_intents");
  });

  it("url for customers", () => {
    const result = buildListResponse([], "/v1/customers", false);
    expect(result.url).toBe("/v1/customers");
  });

  it("url for subscriptions", () => {
    const result = buildListResponse([], "/v1/subscriptions", false);
    expect(result.url).toBe("/v1/subscriptions");
  });

  it("data array contains all provided items", () => {
    const items = [
      { id: "cus_1", name: "Alice" },
      { id: "cus_2", name: "Bob" },
      { id: "cus_3", name: "Charlie" },
    ];
    const result = buildListResponse(items, "/v1/customers", false);
    expect(result.data).toHaveLength(3);
    expect(result.data[0].id).toBe("cus_1");
    expect(result.data[2].name).toBe("Charlie");
  });

  it("data preserves item structure exactly", () => {
    const item = { id: "pi_1", amount: 5000, currency: "usd", metadata: { key: "val" } };
    const result = buildListResponse([item], "/v1/payment_intents", false);
    expect(result.data[0]).toEqual(item);
  });

  it("has_more true with empty data", () => {
    // Edge case: has_more=true with no data is technically valid
    const result = buildListResponse([], "/v1/test", true);
    expect(result.has_more).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("single item in data", () => {
    const result = buildListResponse([{ id: "cus_only" }], "/v1/customers", false);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("cus_only");
  });

  it("with limit matching data length and has_more=true", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `cus_${i}` }));
    const result = buildListResponse(items, "/v1/customers", true);
    expect(result.data).toHaveLength(10);
    expect(result.has_more).toBe(true);
  });

  it("with limit matching data length and has_more=false", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `cus_${i}` }));
    const result = buildListResponse(items, "/v1/customers", false);
    expect(result.data).toHaveLength(10);
    expect(result.has_more).toBe(false);
  });

  it("returns a typed ListResponse", () => {
    const result = buildListResponse<{ id: string }>([{ id: "cus_1" }], "/v1/customers", false);
    expect(result.object).toBe("list");
    expect(result.data[0].id).toBe("cus_1");
  });

  it("handles complex objects in data", () => {
    const items = [
      {
        id: "sub_1",
        status: "active",
        items: { data: [{ id: "si_1", price: { id: "price_1" } }] },
        metadata: {},
      },
    ];
    const result = buildListResponse(items, "/v1/subscriptions", false);
    expect(result.data[0].items.data[0].id).toBe("si_1");
  });
});
