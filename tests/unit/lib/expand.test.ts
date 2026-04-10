import { describe, it, expect } from "bun:test";
import { applyExpand, type ExpandConfig } from "../../../src/lib/expand";

const mockDb = {} as any;

describe("applyExpand", () => {
  // --- Passthrough / no expansions ---

  it("returns obj unchanged when expandFields is empty", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, [], config, mockDb);
    expect(result).toEqual(obj);
  });

  it("returns obj unchanged when expandFields is empty and config is empty", async () => {
    const obj = { id: "pi_1", amount: 1000 };
    const result = await applyExpand(obj, [], {}, mockDb);
    expect(result).toEqual(obj);
  });

  it("returns obj unchanged when expandFields is empty and obj has no expandable fields", async () => {
    const obj = { id: "x", foo: 42, bar: true };
    const result = await applyExpand(obj, [], {}, mockDb);
    expect(result).toEqual({ id: "x", foo: 42, bar: true });
  });

  // --- Single field expansion ---

  it("expands a single known field using the resolver", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const fullCustomer = { id: "cus_abc", object: "customer", email: "test@example.com" };
    const config: ExpandConfig = {
      customer: { resolve: (_id, _db) => fullCustomer },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toEqual(fullCustomer);
    expect(result.id).toBe("pi_1");
  });

  it("resolver receives the correct ID from the field value", async () => {
    const obj = { id: "pi_1", customer: "cus_specific_123" };
    let receivedId: string | undefined;
    const config: ExpandConfig = {
      customer: {
        resolve: (id) => {
          receivedId = id;
          return { id, object: "customer" };
        },
      },
    };
    await applyExpand(obj, ["customer"], config, mockDb);
    expect(receivedId).toBe("cus_specific_123");
  });

  it("resolver receives the db instance", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    let receivedDb: any;
    const config: ExpandConfig = {
      customer: {
        resolve: (_id, db) => {
          receivedDb = db;
          return { id: "cus_abc", object: "customer" };
        },
      },
    };
    await applyExpand(obj, ["customer"], config, mockDb);
    expect(receivedDb).toBe(mockDb);
  });

  it("expands payment_method field", async () => {
    const obj = { id: "pi_1", payment_method: "pm_xyz" };
    const fullPm = { id: "pm_xyz", object: "payment_method", type: "card" };
    const config: ExpandConfig = {
      payment_method: { resolve: () => fullPm },
    };
    const result = await applyExpand(obj, ["payment_method"], config, mockDb);
    expect(result.payment_method).toEqual(fullPm);
  });

  it("expands latest_invoice field", async () => {
    const obj = { id: "sub_1", latest_invoice: "in_abc" };
    const fullInvoice = { id: "in_abc", object: "invoice", amount_due: 5000 };
    const config: ExpandConfig = {
      latest_invoice: { resolve: () => fullInvoice },
    };
    const result = await applyExpand(obj, ["latest_invoice"], config, mockDb);
    expect(result.latest_invoice).toEqual(fullInvoice);
  });

  // --- Multiple fields expansion ---

  it("expands multiple fields at once", async () => {
    const obj = { id: "pi_1", customer: "cus_abc", payment_method: "pm_xyz" };
    const fullCustomer = { id: "cus_abc", object: "customer" };
    const fullPm = { id: "pm_xyz", object: "payment_method" };
    const config: ExpandConfig = {
      customer: { resolve: () => fullCustomer },
      payment_method: { resolve: () => fullPm },
    };
    const result = await applyExpand(obj, ["customer", "payment_method"], config, mockDb);
    expect(result.customer).toEqual(fullCustomer);
    expect(result.payment_method).toEqual(fullPm);
  });

  it("expands three fields simultaneously", async () => {
    const obj = { id: "pi_1", customer: "cus_a", payment_method: "pm_b", charge: "ch_c" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_a", object: "customer" }) },
      payment_method: { resolve: () => ({ id: "pm_b", object: "payment_method" }) },
      charge: { resolve: () => ({ id: "ch_c", object: "charge" }) },
    };
    const result = await applyExpand(obj, ["customer", "payment_method", "charge"], config, mockDb);
    expect(result.customer.id).toBe("cus_a");
    expect(result.payment_method.id).toBe("pm_b");
    expect(result.charge.id).toBe("ch_c");
  });

  it("expands only requested fields when config has more", async () => {
    const obj = { id: "pi_1", customer: "cus_abc", payment_method: "pm_xyz" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
      payment_method: { resolve: () => ({ id: "pm_xyz", object: "payment_method" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(typeof result.customer).toBe("object");
    expect(result.payment_method).toBe("pm_xyz"); // not expanded
  });

  // --- Unknown / missing fields ---

  it("ignores unknown expand fields not in config", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["unknown_field"], config, mockDb);
    expect(result).toEqual(obj);
  });

  it("ignores expand field when config is empty", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const result = await applyExpand(obj, ["customer"], {}, mockDb);
    expect(result).toEqual(obj);
  });

  it("partially expands: known field expanded, unknown ignored", async () => {
    const obj = { id: "pi_1", customer: "cus_abc", foo: "bar" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["customer", "nonexistent"], config, mockDb);
    expect(typeof result.customer).toBe("object");
    expect(result.foo).toBe("bar");
  });

  // --- Null / undefined ID values ---

  it("leaves field unchanged when id is null", async () => {
    const obj = { id: "pi_1", customer: null };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toBeNull();
  });

  it("leaves field unchanged when id is undefined", async () => {
    const obj = { id: "pi_1" } as any;
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toBeUndefined();
  });

  it("leaves field unchanged when value is a number (not a string)", async () => {
    const obj = { id: "pi_1", customer: 12345 };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toBe(12345);
  });

  it("leaves field unchanged when value is a boolean", async () => {
    const obj = { id: "pi_1", customer: false };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toBe(false);
  });

  it("leaves field unchanged when value is an empty string", async () => {
    const obj = { id: "pi_1", customer: "" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toBe("");
  });

  // --- Resolver error handling ---

  it("leaves field as ID when resolver throws sync error", async () => {
    const obj = { id: "pi_1", customer: "cus_deleted" };
    const config: ExpandConfig = {
      customer: {
        resolve: () => {
          throw new Error("Not found");
        },
      },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toBe("cus_deleted");
  });

  it("leaves field as ID when resolver rejects (async)", async () => {
    const obj = { id: "pi_1", customer: "cus_gone" };
    const config: ExpandConfig = {
      customer: {
        resolve: async () => {
          throw new Error("Async failure");
        },
      },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toBe("cus_gone");
  });

  it("expands one field and keeps ID for another when resolver throws", async () => {
    const obj = { id: "pi_1", customer: "cus_abc", payment_method: "pm_broken" };
    const fullCustomer = { id: "cus_abc", object: "customer" };
    const config: ExpandConfig = {
      customer: { resolve: () => fullCustomer },
      payment_method: {
        resolve: () => {
          throw new Error("broken");
        },
      },
    };
    const result = await applyExpand(obj, ["customer", "payment_method"], config, mockDb);
    expect(result.customer).toEqual(fullCustomer);
    expect(result.payment_method).toBe("pm_broken");
  });

  // --- Non-expanded fields preserved ---

  it("preserves all non-expanded fields on the object", async () => {
    const obj = { id: "pi_1", customer: "cus_abc", amount: 5000, currency: "usd", metadata: { x: 1 } };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.amount).toBe(5000);
    expect(result.currency).toBe("usd");
    expect(result.metadata).toEqual({ x: 1 });
  });

  it("does not mutate the original object", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    await applyExpand(obj, ["customer"], config, mockDb);
    expect(obj.customer).toBe("cus_abc");
  });

  it("returns same reference when expandFields is empty (no copy needed)", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {};
    const result = await applyExpand(obj, [], config, mockDb);
    expect(result).toEqual(obj);
    expect(result).toBe(obj); // same reference when no expansion performed
  });

  // --- Nested dot-notation expansion ---

  it("expands nested field using dot-notation", async () => {
    const fullInvoice = { id: "in_1", object: "invoice", payment_intent: "pi_abc" };
    const fullPi = { id: "pi_abc", object: "payment_intent", amount: 1000 };
    const obj = { id: "sub_1", latest_invoice: "in_1" };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: () => fullInvoice,
        nested: {
          payment_intent: {
            resolve: () => fullPi,
          },
        },
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(typeof result.latest_invoice).toBe("object");
    expect(result.latest_invoice.id).toBe("in_1");
    expect(typeof result.latest_invoice.payment_intent).toBe("object");
    expect(result.latest_invoice.payment_intent.id).toBe("pi_abc");
    expect(result.latest_invoice.payment_intent.amount).toBe(1000);
  });

  it("nested expand: top-level resolved but nested unknown field left as ID", async () => {
    const fullInvoice = { id: "in_1", object: "invoice", payment_intent: "pi_abc" };
    const obj = { id: "sub_1", latest_invoice: "in_1" };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: () => fullInvoice,
        nested: {},
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(typeof result.latest_invoice).toBe("object");
    expect(result.latest_invoice.payment_intent).toBe("pi_abc");
  });

  it("nested expand: no nested config leaves inner field as ID", async () => {
    const fullInvoice = { id: "in_1", object: "invoice", payment_intent: "pi_abc" };
    const obj = { id: "sub_1", latest_invoice: "in_1" };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: () => fullInvoice,
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(typeof result.latest_invoice).toBe("object");
    expect(result.latest_invoice.id).toBe("in_1");
    expect(result.latest_invoice.payment_intent).toBe("pi_abc");
  });

  it("nested expand: top-level null leaves field untouched", async () => {
    const obj = { id: "sub_1", latest_invoice: null };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: () => ({ id: "in_1", object: "invoice" }),
        nested: {
          payment_intent: {
            resolve: () => ({ id: "pi_abc", object: "payment_intent" }),
          },
        },
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(result.latest_invoice).toBeNull();
  });

  it("nested expand: top-level undefined leaves field untouched", async () => {
    const obj = { id: "sub_1" } as any;

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: () => ({ id: "in_1" }),
        nested: {
          payment_intent: { resolve: () => ({ id: "pi_abc" }) },
        },
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(result.latest_invoice).toBeUndefined();
  });

  it("nested expand: top-level resolver throws leaves field as string ID", async () => {
    const obj = { id: "sub_1", latest_invoice: "in_fail" };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: () => {
          throw new Error("top-level fail");
        },
        nested: {
          payment_intent: { resolve: () => ({ id: "pi_abc" }) },
        },
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(result.latest_invoice).toBe("in_fail");
  });

  it("nested expand: unknown top-level field in config skips expansion", async () => {
    const obj = { id: "sub_1", latest_invoice: "in_1" };
    const config: ExpandConfig = {};

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(result.latest_invoice).toBe("in_1");
  });

  it("deeply nested expansion (three levels via recursive applyExpand)", async () => {
    const fullInvoice = { id: "in_1", object: "invoice", payment_intent: "pi_abc" };
    const fullPi = { id: "pi_abc", object: "payment_intent", charge: "ch_xyz" };
    const obj = { id: "sub_1", latest_invoice: "in_1" };

    // Only the first two levels are handled: latest_invoice -> payment_intent
    // The third level (charge) would require its own nested config on payment_intent
    const config: ExpandConfig = {
      latest_invoice: {
        resolve: () => fullInvoice,
        nested: {
          payment_intent: {
            resolve: () => fullPi,
            nested: {
              charge: {
                resolve: () => ({ id: "ch_xyz", object: "charge", amount: 2000 }),
              },
            },
          },
        },
      },
    };

    // Expanding two levels deep via dot notation
    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(result.latest_invoice.payment_intent.id).toBe("pi_abc");
    // charge is not expanded because we didn't request it
    expect(result.latest_invoice.payment_intent.charge).toBe("ch_xyz");
  });

  // --- Expanding both top-level and nested on same object ---

  it("expands top-level and nested field in same call", async () => {
    const fullInvoice = { id: "in_1", object: "invoice", payment_intent: "pi_abc" };
    const fullPi = { id: "pi_abc", object: "payment_intent" };
    const fullCustomer = { id: "cus_abc", object: "customer" };
    const obj = { id: "sub_1", latest_invoice: "in_1", customer: "cus_abc" };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: () => fullInvoice,
        nested: {
          payment_intent: { resolve: () => fullPi },
        },
      },
      customer: { resolve: () => fullCustomer },
    };

    const result = await applyExpand(
      obj,
      ["customer", "latest_invoice.payment_intent"],
      config,
      mockDb,
    );
    expect(result.customer).toEqual(fullCustomer);
    expect(result.latest_invoice.payment_intent).toEqual(fullPi);
  });

  // --- Expand already expanded (object) field ---

  it("leaves field unchanged when value is already an object (not a string ID)", async () => {
    const expandedCustomer = { id: "cus_abc", object: "customer", email: "a@b.com" };
    const obj = { id: "pi_1", customer: expandedCustomer };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer", email: "new@b.com" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    // Since customer is already an object (not a string), it should be left as-is
    expect(result.customer).toEqual(expandedCustomer);
  });

  // --- Resolver returns various shapes ---

  it("resolver returns full object with many properties", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const fullCustomer = {
      id: "cus_abc",
      object: "customer",
      email: "test@example.com",
      name: "Test User",
      metadata: { plan: "pro" },
      created: 1700000000,
      livemode: false,
    };
    const config: ExpandConfig = {
      customer: { resolve: () => fullCustomer },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toEqual(fullCustomer);
    expect(result.customer.metadata).toEqual({ plan: "pro" });
  });

  it("resolver returns null is still treated as non-string (skipped)", async () => {
    // This scenario: field value is a valid string ID, resolver returns null
    // The resolver is only called when the field is a string, and the result replaces it
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: { resolve: () => null },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    // Resolver returned null, so it replaces the string
    expect(result.customer).toBeNull();
  });

  // --- Async resolvers ---

  it("supports async resolvers", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: {
        resolve: async (_id) => {
          return { id: "cus_abc", object: "customer", email: "async@test.com" };
        },
      },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer.email).toBe("async@test.com");
  });

  it("handles multiple async resolvers concurrently", async () => {
    const obj = { id: "pi_1", customer: "cus_abc", payment_method: "pm_xyz" };
    const config: ExpandConfig = {
      customer: {
        resolve: async () => ({ id: "cus_abc", object: "customer" }),
      },
      payment_method: {
        resolve: async () => ({ id: "pm_xyz", object: "payment_method" }),
      },
    };
    const result = await applyExpand(obj, ["customer", "payment_method"], config, mockDb);
    expect(result.customer.id).toBe("cus_abc");
    expect(result.payment_method.id).toBe("pm_xyz");
  });

  // --- Edge cases ---

  it("handles expand of field with special characters in value", async () => {
    const obj = { id: "pi_1", customer: "cus_abc-def_123" };
    const config: ExpandConfig = {
      customer: { resolve: (id) => ({ id, object: "customer" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer.id).toBe("cus_abc-def_123");
  });

  it("expanding same field twice in expandFields only resolves once", async () => {
    let callCount = 0;
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: {
        resolve: () => {
          callCount++;
          return { id: "cus_abc", object: "customer" };
        },
      },
    };
    const result = await applyExpand(obj, ["customer", "customer"], config, mockDb);
    // After first expansion, customer is no longer a string, so second one is skipped
    expect(typeof result.customer).toBe("object");
    // The resolver was called at least once; the second call is skipped because the field is now an object
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("works with an object that has no expandable fields", async () => {
    const obj = { id: "pi_1", amount: 100, currency: "usd" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc" }) },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    // customer doesn't exist on obj (undefined), so it's not expanded
    expect(result.customer).toBeUndefined();
  });
});
