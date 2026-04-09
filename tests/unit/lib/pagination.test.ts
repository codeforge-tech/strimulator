import { describe, test, expect } from "bun:test";
import { buildListResponse, parseListParams } from "../../../src/lib/pagination";

describe("buildListResponse", () => {
  test("wraps items in Stripe list envelope", () => {
    const items = [{ id: "cus_1" }, { id: "cus_2" }];
    const result = buildListResponse(items, "/v1/customers", false);
    expect(result).toEqual({
      object: "list",
      data: [{ id: "cus_1" }, { id: "cus_2" }],
      has_more: false,
      url: "/v1/customers",
    });
  });

  test("sets has_more when more items exist", () => {
    const result = buildListResponse([{ id: "cus_1" }], "/v1/customers", true);
    expect(result.has_more).toBe(true);
  });

  test("returns empty list", () => {
    const result = buildListResponse([], "/v1/customers", false);
    expect(result.data).toEqual([]);
    expect(result.has_more).toBe(false);
  });
});

describe("parseListParams", () => {
  test("extracts pagination params", () => {
    const params = parseListParams({ limit: "25", starting_after: "cus_abc123" });
    expect(params).toEqual({ limit: 25, startingAfter: "cus_abc123", endingBefore: undefined });
  });

  test("defaults limit to 10, caps at 100", () => {
    expect(parseListParams({}).limit).toBe(10);
    expect(parseListParams({ limit: "200" }).limit).toBe(100);
    expect(parseListParams({ limit: "0" }).limit).toBe(1);
  });
});
