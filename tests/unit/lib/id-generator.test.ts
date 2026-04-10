import { describe, it, expect } from "bun:test";
import { generateId, generateSecret, ID_PREFIXES, type ResourceType } from "../../../src/lib/id-generator";

describe("ID_PREFIXES", () => {
  it("has a prefix for customer", () => {
    expect(ID_PREFIXES.customer).toBe("cus");
  });

  it("has a prefix for product", () => {
    expect(ID_PREFIXES.product).toBe("prod");
  });

  it("has a prefix for price", () => {
    expect(ID_PREFIXES.price).toBe("price");
  });

  it("has a prefix for payment_intent", () => {
    expect(ID_PREFIXES.payment_intent).toBe("pi");
  });

  it("has a prefix for charge", () => {
    expect(ID_PREFIXES.charge).toBe("ch");
  });

  it("has a prefix for refund", () => {
    expect(ID_PREFIXES.refund).toBe("re");
  });

  it("has a prefix for payment_method", () => {
    expect(ID_PREFIXES.payment_method).toBe("pm");
  });

  it("has a prefix for subscription", () => {
    expect(ID_PREFIXES.subscription).toBe("sub");
  });

  it("has a prefix for subscription_item", () => {
    expect(ID_PREFIXES.subscription_item).toBe("si");
  });

  it("has a prefix for invoice", () => {
    expect(ID_PREFIXES.invoice).toBe("in");
  });

  it("has a prefix for setup_intent", () => {
    expect(ID_PREFIXES.setup_intent).toBe("seti");
  });

  it("has a prefix for event", () => {
    expect(ID_PREFIXES.event).toBe("evt");
  });

  it("has a prefix for webhook_endpoint", () => {
    expect(ID_PREFIXES.webhook_endpoint).toBe("we");
  });

  it("has a prefix for test_clock", () => {
    expect(ID_PREFIXES.test_clock).toBe("clock");
  });

  it("has a prefix for invoice_line_item", () => {
    expect(ID_PREFIXES.invoice_line_item).toBe("il");
  });

  it("has a prefix for webhook_delivery", () => {
    expect(ID_PREFIXES.webhook_delivery).toBe("whdel");
  });

  it("has a prefix for idempotency_key", () => {
    expect(ID_PREFIXES.idempotency_key).toBe("idk");
  });
});

describe("generateId", () => {
  const allTypes = Object.keys(ID_PREFIXES) as ResourceType[];

  it("generates customer ID with cus_ prefix", () => {
    const id = generateId("customer");
    expect(id.startsWith("cus_")).toBe(true);
  });

  it("generates product ID with prod_ prefix", () => {
    const id = generateId("product");
    expect(id.startsWith("prod_")).toBe(true);
  });

  it("generates price ID with price_ prefix", () => {
    const id = generateId("price");
    expect(id.startsWith("price_")).toBe(true);
  });

  it("generates payment_intent ID with pi_ prefix", () => {
    const id = generateId("payment_intent");
    expect(id.startsWith("pi_")).toBe(true);
  });

  it("generates charge ID with ch_ prefix", () => {
    const id = generateId("charge");
    expect(id.startsWith("ch_")).toBe(true);
  });

  it("generates refund ID with re_ prefix", () => {
    const id = generateId("refund");
    expect(id.startsWith("re_")).toBe(true);
  });

  it("generates payment_method ID with pm_ prefix", () => {
    const id = generateId("payment_method");
    expect(id.startsWith("pm_")).toBe(true);
  });

  it("generates subscription ID with sub_ prefix", () => {
    const id = generateId("subscription");
    expect(id.startsWith("sub_")).toBe(true);
  });

  it("generates subscription_item ID with si_ prefix", () => {
    const id = generateId("subscription_item");
    expect(id.startsWith("si_")).toBe(true);
  });

  it("generates invoice ID with in_ prefix", () => {
    const id = generateId("invoice");
    expect(id.startsWith("in_")).toBe(true);
  });

  it("generates setup_intent ID with seti_ prefix", () => {
    const id = generateId("setup_intent");
    expect(id.startsWith("seti_")).toBe(true);
  });

  it("generates event ID with evt_ prefix", () => {
    const id = generateId("event");
    expect(id.startsWith("evt_")).toBe(true);
  });

  it("generates webhook_endpoint ID with we_ prefix", () => {
    const id = generateId("webhook_endpoint");
    expect(id.startsWith("we_")).toBe(true);
  });

  it("generates test_clock ID with clock_ prefix", () => {
    const id = generateId("test_clock");
    expect(id.startsWith("clock_")).toBe(true);
  });

  it("every type produces an ID with the correct prefix", () => {
    for (const type of allTypes) {
      const id = generateId(type);
      const expectedPrefix = ID_PREFIXES[type] + "_";
      expect(id.startsWith(expectedPrefix)).toBe(true);
    }
  });

  it("generated ID has the right total length (prefix + _ + 14 random chars)", () => {
    for (const type of allTypes) {
      const id = generateId(type);
      const prefix = ID_PREFIXES[type];
      // Format: prefix_<14 chars>
      expect(id.length).toBe(prefix.length + 1 + 14);
    }
  });

  it("random part contains only base64url chars", () => {
    for (const type of allTypes) {
      const id = generateId(type);
      const prefix = ID_PREFIXES[type];
      const randomPart = id.slice(prefix.length + 1);
      expect(randomPart).toMatch(/^[a-zA-Z0-9_-]{14}$/);
    }
  });

  it("generates 100 unique customer IDs (no collisions)", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("customer")));
    expect(ids.size).toBe(100);
  });

  it("generates 100 unique payment_intent IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("payment_intent")));
    expect(ids.size).toBe(100);
  });

  it("generates 500 IDs rapidly without collisions", () => {
    const ids = new Set<string>();
    for (const type of allTypes) {
      for (let i = 0; i < 30; i++) {
        ids.add(generateId(type));
      }
    }
    // All should be unique (allTypes.length * 30)
    expect(ids.size).toBe(allTypes.length * 30);
  });

  it("IDs from different types are always different (different prefixes)", () => {
    const cusId = generateId("customer");
    const piId = generateId("payment_intent");
    expect(cusId).not.toBe(piId);
    expect(cusId.slice(0, 3)).not.toBe(piId.slice(0, 3));
  });
});

describe("generateSecret", () => {
  it("produces a string with the given prefix", () => {
    const secret = generateSecret("whsec");
    expect(secret.startsWith("whsec_")).toBe(true);
  });

  it("produces a string with sk_test prefix", () => {
    const secret = generateSecret("sk_test");
    expect(secret.startsWith("sk_test_")).toBe(true);
  });

  it("produces a secret with correct format: prefix + _ + base64url random", () => {
    const secret = generateSecret("whsec");
    const parts = secret.split("_");
    expect(parts[0]).toBe("whsec");
    expect(parts.slice(1).join("_").length).toBeGreaterThan(0);
  });

  it("generates unique secrets", () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateSecret("whsec")));
    expect(secrets.size).toBe(100);
  });

  it("secret random part is base64url encoded (24 random bytes)", () => {
    const secret = generateSecret("test");
    const randomPart = secret.slice("test_".length);
    // 24 bytes -> 32 base64url chars
    expect(randomPart).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(randomPart.length).toBe(32);
  });

  it("works with empty prefix", () => {
    const secret = generateSecret("");
    expect(secret.startsWith("_")).toBe(true);
    expect(secret.length).toBeGreaterThan(1);
  });
});
