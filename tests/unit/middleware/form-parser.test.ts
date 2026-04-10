import { describe, it, expect } from "bun:test";
import { parseStripeBody } from "../../../src/middleware/form-parser";

describe("parseStripeBody", () => {
  // --- Empty / blank inputs ---

  it("returns empty object for empty string", () => {
    expect(parseStripeBody("")).toEqual({});
  });

  it("returns empty object for whitespace-only string", () => {
    expect(parseStripeBody("   ")).toEqual({});
  });

  it("returns empty object for tab/newline whitespace", () => {
    expect(parseStripeBody("\t\n")).toEqual({});
  });

  // --- Simple key=value ---

  it("parses single flat key=value", () => {
    expect(parseStripeBody("name=Bob")).toEqual({ name: "Bob" });
  });

  it("parses multiple flat key=value pairs", () => {
    const result = parseStripeBody("email=test%40example.com&name=Alice");
    expect(result).toEqual({ email: "test@example.com", name: "Alice" });
  });

  it("parses three flat keys", () => {
    const result = parseStripeBody("amount=1000&currency=usd&description=test");
    expect(result).toEqual({ amount: "1000", currency: "usd", description: "test" });
  });

  // --- URL encoding ---

  it("decodes %40 as @", () => {
    const result = parseStripeBody("email=user%40example.com");
    expect(result.email).toBe("user@example.com");
  });

  it("decodes %20 as space", () => {
    const result = parseStripeBody("description=Hello%20World");
    expect(result.description).toBe("Hello World");
  });

  it("decodes + as space", () => {
    const result = parseStripeBody("description=Hello+World");
    expect(result.description).toBe("Hello World");
  });

  it("decodes + in key as space", () => {
    const result = parseStripeBody("my+key=value");
    expect(result["my key"]).toBe("value");
  });

  it("decodes %26 (encoded ampersand) in value", () => {
    const result = parseStripeBody("name=A%26B");
    expect(result.name).toBe("A&B");
  });

  it("decodes %3D (encoded equals) in value", () => {
    const result = parseStripeBody("formula=1%2B1%3D2");
    expect(result.formula).toBe("1+1=2");
  });

  it("handles unicode encoded values", () => {
    const result = parseStripeBody("name=%C3%A9l%C3%A8ve");
    expect(result.name).toBe("\u00e9l\u00e8ve"); // eleve with accents
  });

  // --- Empty value ---

  it("parses key with empty value", () => {
    const result = parseStripeBody("name=");
    expect(result.name).toBe("");
  });

  it("parses multiple keys where one has empty value", () => {
    const result = parseStripeBody("name=&email=test%40test.com");
    expect(result.name).toBe("");
    expect(result.email).toBe("test@test.com");
  });

  // --- Nested objects (bracket notation) ---

  it("parses simple bracket notation for nested objects", () => {
    const result = parseStripeBody("metadata[key]=value");
    expect(result).toEqual({ metadata: { key: "value" } });
  });

  it("parses multiple keys in same nested object", () => {
    const result = parseStripeBody("metadata[key]=value&metadata[other]=thing");
    expect(result).toEqual({ metadata: { key: "value", other: "thing" } });
  });

  it("parses deeply nested bracket notation (three levels)", () => {
    const result = parseStripeBody("a[b][c]=deep");
    expect(result).toEqual({ a: { b: { c: "deep" } } });
  });

  it("parses four levels of nesting", () => {
    const result = parseStripeBody("a[b][c][d]=value");
    expect(result).toEqual({ a: { b: { c: { d: "value" } } } });
  });

  it("parses mixed flat and nested keys", () => {
    const result = parseStripeBody("amount=1000&currency=usd&metadata[order_id]=123");
    expect(result).toEqual({ amount: "1000", currency: "usd", metadata: { order_id: "123" } });
  });

  // --- Indexed arrays ---

  it("parses indexed array with single item", () => {
    const result = parseStripeBody("items[0][price]=price_abc");
    expect(result).toEqual({ items: [{ price: "price_abc" }] });
  });

  it("parses indexed array with multiple properties on same item", () => {
    const result = parseStripeBody("items[0][price]=price_abc&items[0][quantity]=2");
    expect(result).toEqual({ items: [{ price: "price_abc", quantity: "2" }] });
  });

  it("parses indexed array with multiple items", () => {
    const result = parseStripeBody("items[0][price]=price_abc&items[1][price]=price_xyz");
    expect(result).toEqual({ items: [{ price: "price_abc" }, { price: "price_xyz" }] });
  });

  it("parses indexed array with three items", () => {
    const result = parseStripeBody(
      "items[0][price]=p0&items[1][price]=p1&items[2][price]=p2",
    );
    expect(result.items).toHaveLength(3);
    expect(result.items[0].price).toBe("p0");
    expect(result.items[1].price).toBe("p1");
    expect(result.items[2].price).toBe("p2");
  });

  it("parses indexed array with nested properties", () => {
    const result = parseStripeBody(
      "items[0][price_data][unit_amount]=1000&items[0][price_data][currency]=usd",
    );
    expect(result).toEqual({
      items: [{ price_data: { unit_amount: "1000", currency: "usd" } }],
    });
  });

  // --- Push arrays (expand[]) ---

  it("parses push array with single item", () => {
    const result = parseStripeBody("expand[]=customer");
    expect(result).toEqual({ expand: ["customer"] });
  });

  it("parses push array with multiple items", () => {
    const result = parseStripeBody("expand[]=customer&expand[]=payment_method");
    expect(result).toEqual({ expand: ["customer", "payment_method"] });
  });

  it("parses push array with three items", () => {
    const result = parseStripeBody("expand[]=a&expand[]=b&expand[]=c");
    expect(result.expand).toEqual(["a", "b", "c"]);
  });

  // --- Mixed types ---

  it("parses complex realistic Stripe body", () => {
    const body =
      "amount=2000&currency=usd&customer=cus_abc123&payment_method=pm_xyz&metadata[order_id]=ord_123&metadata[env]=test&expand[]=customer&expand[]=payment_method";
    const result = parseStripeBody(body);
    expect(result.amount).toBe("2000");
    expect(result.currency).toBe("usd");
    expect(result.customer).toBe("cus_abc123");
    expect(result.payment_method).toBe("pm_xyz");
    expect(result.metadata).toEqual({ order_id: "ord_123", env: "test" });
    expect(result.expand).toEqual(["customer", "payment_method"]);
  });

  it("parses subscription creation body", () => {
    const body =
      "customer=cus_abc&items[0][price]=price_monthly&items[0][quantity]=1&metadata[plan]=pro";
    const result = parseStripeBody(body);
    expect(result.customer).toBe("cus_abc");
    expect(result.items).toEqual([{ price: "price_monthly", quantity: "1" }]);
    expect(result.metadata).toEqual({ plan: "pro" });
  });

  // --- Boolean-like / numeric values ---

  it("parses boolean-like values as strings", () => {
    const result = parseStripeBody("livemode=false&capture=true");
    expect(result.livemode).toBe("false");
    expect(result.capture).toBe("true");
  });

  it("parses numeric values as strings", () => {
    const result = parseStripeBody("amount=5000&quantity=3");
    expect(result.amount).toBe("5000");
    expect(result.quantity).toBe("3");
  });

  // --- Special characters in keys and values ---

  it("handles special characters in metadata values", () => {
    const result = parseStripeBody("metadata[note]=Hello%2C+World%21");
    expect(result.metadata.note).toBe("Hello, World!");
  });

  it("handles metadata keys with hyphens", () => {
    const result = parseStripeBody("metadata[my-key]=value");
    expect(result.metadata["my-key"]).toBe("value");
  });

  // --- Edge cases ---

  it("ignores pairs without = sign", () => {
    const result = parseStripeBody("noequalsign&name=Bob");
    expect(result).toEqual({ name: "Bob" });
  });

  it("handles multiple = signs (value contains =)", () => {
    const result = parseStripeBody("formula=1+1=2");
    // Only splits on first =
    expect(result.formula).toBe("1 1=2");
  });

  it("handles trailing ampersand", () => {
    const result = parseStripeBody("name=Bob&");
    expect(result).toEqual({ name: "Bob" });
  });

  it("handles leading ampersand", () => {
    const result = parseStripeBody("&name=Bob");
    expect(result).toEqual({ name: "Bob" });
  });

  it("handles double ampersand", () => {
    const result = parseStripeBody("name=Bob&&email=test%40test.com");
    expect(result.name).toBe("Bob");
    expect(result.email).toBe("test@test.com");
  });

  it("overwrites duplicate flat keys (last wins)", () => {
    const result = parseStripeBody("name=Alice&name=Bob");
    expect(result.name).toBe("Bob");
  });
});
