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
});
