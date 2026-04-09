import { describe, it, expect } from "bun:test";
import { applyExpand, type ExpandConfig } from "../../../src/lib/expand";

// A minimal mock DB type to satisfy the resolver signature
const mockDb = {} as any;

describe("applyExpand", () => {
  it("returns obj unchanged when expandFields is empty", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, [], config, mockDb);
    expect(result).toEqual(obj);
  });

  it("expands a known field using the resolver", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const fullCustomer = { id: "cus_abc", object: "customer", email: "test@example.com" };
    const config: ExpandConfig = {
      customer: { resolve: (_id, _db) => fullCustomer },
    };
    const result = await applyExpand(obj, ["customer"], config, mockDb);
    expect(result.customer).toEqual(fullCustomer);
    expect(result.id).toBe("pi_1");
  });

  it("ignores unknown expand fields", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    const result = await applyExpand(obj, ["unknown_field"], config, mockDb);
    expect(result).toEqual(obj);
  });

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

  it("leaves field as ID when resolver throws", async () => {
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

  it("does not mutate the original object", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    const config: ExpandConfig = {
      customer: { resolve: () => ({ id: "cus_abc", object: "customer" }) },
    };
    await applyExpand(obj, ["customer"], config, mockDb);
    expect(obj.customer).toBe("cus_abc");
  });

  it("passes the id and db to the resolver", async () => {
    const obj = { id: "pi_1", customer: "cus_abc" };
    let receivedId: string | undefined;
    let receivedDb: any;
    const config: ExpandConfig = {
      customer: {
        resolve: (id, db) => {
          receivedId = id;
          receivedDb = db;
          return { id, object: "customer" };
        },
      },
    };
    await applyExpand(obj, ["customer"], config, mockDb);
    expect(receivedId).toBe("cus_abc");
    expect(receivedDb).toBe(mockDb);
  });

  it("expands nested field using dot-notation", async () => {
    const fullInvoice = { id: "in_1", object: "invoice", payment_intent: "pi_abc" };
    const fullPi = { id: "pi_abc", object: "payment_intent", amount: 1000 };
    const obj = { id: "sub_1", latest_invoice: "in_1" };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: (_id, _db) => fullInvoice,
        nested: {
          payment_intent: {
            resolve: (_id, _db) => fullPi,
          },
        },
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(typeof result.latest_invoice).toBe("object");
    expect(result.latest_invoice.id).toBe("in_1");
    expect(typeof result.latest_invoice.payment_intent).toBe("object");
    expect(result.latest_invoice.payment_intent.id).toBe("pi_abc");
  });

  it("nested expand with unknown nested field leaves inner field as ID", async () => {
    const fullInvoice = { id: "in_1", object: "invoice", payment_intent: "pi_abc" };
    const obj = { id: "sub_1", latest_invoice: "in_1" };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: (_id, _db) => fullInvoice,
        nested: {
          // no payment_intent here
        },
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    // Top-level resolved, but nested field left as string ID
    expect(typeof result.latest_invoice).toBe("object");
    expect(result.latest_invoice.id).toBe("in_1");
    expect(result.latest_invoice.payment_intent).toBe("pi_abc");
  });

  it("nested expand with no nested config leaves inner field as ID", async () => {
    const fullInvoice = { id: "in_1", object: "invoice", payment_intent: "pi_abc" };
    const obj = { id: "sub_1", latest_invoice: "in_1" };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: (_id, _db) => fullInvoice,
        // no nested config at all
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    // Top-level resolved, but nested field left as string ID
    expect(typeof result.latest_invoice).toBe("object");
    expect(result.latest_invoice.id).toBe("in_1");
    expect(result.latest_invoice.payment_intent).toBe("pi_abc");
  });

  it("nested expand: top-level not a string ID leaves field untouched", async () => {
    const obj = { id: "sub_1", latest_invoice: null };

    const config: ExpandConfig = {
      latest_invoice: {
        resolve: (_id, _db) => ({ id: "in_1", object: "invoice" }),
        nested: {
          payment_intent: {
            resolve: (_id, _db) => ({ id: "pi_abc", object: "payment_intent" }),
          },
        },
      },
    };

    const result = await applyExpand(obj, ["latest_invoice.payment_intent"], config, mockDb);
    expect(result.latest_invoice).toBeNull();
  });
});
