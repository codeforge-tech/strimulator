import { describe, test, expect } from "bun:test";
import { parseStripeBody } from "../../../src/middleware/form-parser";

describe("parseStripeBody", () => {
  test("empty string returns empty object", () => {
    expect(parseStripeBody("")).toEqual({});
  });

  test("whitespace-only string returns empty object", () => {
    expect(parseStripeBody("   ")).toEqual({});
  });

  test("flat key-value pairs", () => {
    const result = parseStripeBody("email=test%40example.com&name=Alice");
    expect(result).toEqual({ email: "test@example.com", name: "Alice" });
  });

  test("bracket notation for nested objects", () => {
    const result = parseStripeBody("metadata[key]=value&metadata[other]=thing");
    expect(result).toEqual({ metadata: { key: "value", other: "thing" } });
  });

  test("indexed array notation", () => {
    const result = parseStripeBody("items[0][price]=price_abc&items[0][quantity]=2");
    expect(result).toEqual({ items: [{ price: "price_abc", quantity: "2" }] });
  });

  test("indexed array notation with multiple entries", () => {
    const result = parseStripeBody("items[0][price]=price_abc&items[1][price]=price_xyz");
    expect(result).toEqual({ items: [{ price: "price_abc" }, { price: "price_xyz" }] });
  });

  test("push array notation (expand[])", () => {
    const result = parseStripeBody("expand[]=customer&expand[]=payment_method");
    expect(result).toEqual({ expand: ["customer", "payment_method"] });
  });

  test("mixed flat and nested keys", () => {
    const result = parseStripeBody("amount=1000&currency=usd&metadata[order_id]=123");
    expect(result).toEqual({ amount: "1000", currency: "usd", metadata: { order_id: "123" } });
  });

  test("URL-encoded values are decoded", () => {
    const result = parseStripeBody("description=Hello%20World");
    expect(result).toEqual({ description: "Hello World" });
  });

  test("plus signs in values decoded as spaces", () => {
    const result = parseStripeBody("description=Hello+World");
    expect(result).toEqual({ description: "Hello World" });
  });

  test("deeply nested bracket notation", () => {
    const result = parseStripeBody("a[b][c]=deep");
    expect(result).toEqual({ a: { b: { c: "deep" } } });
  });

  test("single flat key", () => {
    const result = parseStripeBody("name=Bob");
    expect(result).toEqual({ name: "Bob" });
  });
});
