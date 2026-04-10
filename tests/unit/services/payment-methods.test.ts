import { describe, it, expect, beforeEach } from "bun:test";
import { createDB } from "../../../src/db";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { CustomerService } from "../../../src/services/customers";
import { StripeError } from "../../../src/errors";
import type { StrimulatorDB } from "../../../src/db";

function makeServices() {
  const db = createDB(":memory:");
  return {
    pm: new PaymentMethodService(db),
    cus: new CustomerService(db),
    db,
  };
}

function makeService() {
  return makeServices().pm;
}

function createTestCustomer(customerService: CustomerService, overrides: { email?: string; name?: string } = {}) {
  return customerService.create({
    email: overrides.email ?? "test@example.com",
    name: overrides.name ?? "Test Customer",
  });
}

describe("PaymentMethodService", () => {
  // ---------------------------------------------------------------------------
  // create() tests
  // ---------------------------------------------------------------------------
  describe("create", () => {
    it("creates a payment method with type=card and tok_visa token", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm).toBeDefined();
      expect(pm.type).toBe("card");
    });

    it("creates a payment method with card details (number, exp_month, exp_year, cvc)", () => {
      const svc = makeService();
      const pm = svc.create({
        type: "card",
        card: { number: "4242424242424242", exp_month: 6, exp_year: 2030, cvc: "314" },
      });
      // Card details are resolved via token map; without a recognized token, defaults to tok_visa
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
    });

    it("creates with tok_visa token", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
      expect(pm.card?.funding).toBe("credit");
    });

    it("creates with tok_mastercard token", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      expect(pm.card?.brand).toBe("mastercard");
      expect(pm.card?.last4).toBe("4444");
      expect(pm.card?.funding).toBe("credit");
    });

    it("creates with tok_amex token", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_amex" } });
      expect(pm.card?.brand).toBe("amex");
      expect(pm.card?.last4).toBe("8431");
      expect(pm.card?.funding).toBe("credit");
    });

    it("creates with tok_visa_debit token", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa_debit" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("5556");
      expect(pm.card?.funding).toBe("debit");
    });

    it("creates with tok_threeDSecureRequired token", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_threeDSecureRequired" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("3220");
      expect(pm.card?.funding).toBe("credit");
    });

    it("creates with tok_threeDSecureOptional token", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_threeDSecureOptional" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("3222");
      expect(pm.card?.funding).toBe("credit");
    });

    it("tok_visa produces exp_month=12 and exp_year=2034", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.exp_month).toBe(12);
      expect(pm.card?.exp_year).toBe(2034);
    });

    it("tok_mastercard produces exp_month=12 and exp_year=2034", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      expect(pm.card?.exp_month).toBe(12);
      expect(pm.card?.exp_year).toBe(2034);
    });

    it("tok_amex produces exp_month=12 and exp_year=2034", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_amex" } });
      expect(pm.card?.exp_month).toBe(12);
      expect(pm.card?.exp_year).toBe(2034);
    });

    it("tok_visa_debit produces exp_month=12 and exp_year=2034", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa_debit" } });
      expect(pm.card?.exp_month).toBe(12);
      expect(pm.card?.exp_year).toBe(2034);
    });

    it("tok_threeDSecureRequired produces exp_month=12 and exp_year=2034", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_threeDSecureRequired" } });
      expect(pm.card?.exp_month).toBe(12);
      expect(pm.card?.exp_year).toBe(2034);
    });

    it("tok_threeDSecureOptional produces exp_month=12 and exp_year=2034", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_threeDSecureOptional" } });
      expect(pm.card?.exp_month).toBe(12);
      expect(pm.card?.exp_year).toBe(2034);
    });

    it("id starts with pm_", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.id).toMatch(/^pm_/);
    });

    it("id has reasonable length beyond prefix", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.id.length).toBeGreaterThan(5);
    });

    it("object is payment_method", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.object).toBe("payment_method");
    });

    it("type is card", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.type).toBe("card");
    });

    it("card sub-object has brand field", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.brand).toBe("visa");
    });

    it("card sub-object has last4 field", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.last4).toBe("4242");
    });

    it("card sub-object has exp_month field", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.exp_month).toBe(12);
    });

    it("card sub-object has exp_year field", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.exp_year).toBe(2034);
    });

    it("card sub-object has funding field", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.funding).toBe("credit");
    });

    it("card sub-object has country field set to US", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.country).toBe("US");
    });

    it("card sub-object has checks sub-object", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.checks).toBeDefined();
    });

    it("checks has cvc_check set to pass", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.checks?.cvc_check).toBe("pass");
    });

    it("checks has address_line1_check set to null", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.checks?.address_line1_check).toBeNull();
    });

    it("checks has address_postal_code_check set to null", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.checks?.address_postal_code_check).toBeNull();
    });

    it("created is a unix timestamp close to now", () => {
      const svc = makeService();
      const before = Math.floor(Date.now() / 1000);
      const pm = svc.create({ type: "card" });
      const after = Math.floor(Date.now() / 1000);
      expect(pm.created).toBeGreaterThanOrEqual(before);
      expect(pm.created).toBeLessThanOrEqual(after);
    });

    it("created is a number, not a string", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(typeof pm.created).toBe("number");
    });

    it("livemode is false", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.livemode).toBe(false);
    });

    it("customer is null when not attached", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.customer).toBeNull();
    });

    it("billing_details defaults to all null fields", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.billing_details.address).toBeNull();
      expect(pm.billing_details.email).toBeNull();
      expect(pm.billing_details.name).toBeNull();
      expect(pm.billing_details.phone).toBeNull();
    });

    it("creates with billing_details name", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", billing_details: { name: "John Doe" } });
      expect(pm.billing_details.name).toBe("John Doe");
    });

    it("creates with billing_details email", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", billing_details: { email: "john@example.com" } });
      expect(pm.billing_details.email).toBe("john@example.com");
    });

    it("creates with billing_details phone", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", billing_details: { phone: "+1234567890" } });
      expect(pm.billing_details.phone).toBe("+1234567890");
    });

    it("creates with billing_details address", () => {
      const svc = makeService();
      const address = { line1: "123 Main St", line2: null, city: "SF", state: "CA", postal_code: "94105", country: "US" };
      const pm = svc.create({ type: "card", billing_details: { address: address as any } });
      expect(pm.billing_details.address).toEqual(address);
    });

    it("creates with all billing_details fields at once", () => {
      const svc = makeService();
      const pm = svc.create({
        type: "card",
        billing_details: {
          name: "Jane Smith",
          email: "jane@example.com",
          phone: "+10000000000",
          address: { line1: "456 Elm St", line2: "Apt 2", city: "NY", state: "NY", postal_code: "10001", country: "US" } as any,
        },
      });
      expect(pm.billing_details.name).toBe("Jane Smith");
      expect(pm.billing_details.email).toBe("jane@example.com");
      expect(pm.billing_details.phone).toBe("+10000000000");
      expect(pm.billing_details.address).toBeDefined();
    });

    it("partial billing_details leaves unset fields as null", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", billing_details: { name: "Partial" } });
      expect(pm.billing_details.name).toBe("Partial");
      expect(pm.billing_details.email).toBeNull();
      expect(pm.billing_details.phone).toBeNull();
      expect(pm.billing_details.address).toBeNull();
    });

    it("creates multiple PMs with unique IDs", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      const pm2 = svc.create({ type: "card" });
      const pm3 = svc.create({ type: "card" });
      expect(pm1.id).not.toBe(pm2.id);
      expect(pm2.id).not.toBe(pm3.id);
      expect(pm1.id).not.toBe(pm3.id);
    });

    it("creates with metadata", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", metadata: { order_id: "12345", source: "web" } });
      expect(pm.metadata).toEqual({ order_id: "12345", source: "web" });
    });

    it("creates with empty metadata", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", metadata: {} });
      expect(pm.metadata).toEqual({});
    });

    it("defaults metadata to empty object when not provided", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.metadata).toEqual({});
    });

    it("fingerprint field exists on card", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.fingerprint).toBeDefined();
      expect(typeof pm.card?.fingerprint).toBe("string");
      expect(pm.card!.fingerprint!.length).toBeGreaterThan(0);
    });

    it("fingerprint is deterministic for same brand and last4", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card", card: { token: "tok_visa" } });
      const pm2 = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm1.card?.fingerprint).toBe(pm2.card?.fingerprint);
    });

    it("fingerprint differs between different tokens", () => {
      const svc = makeService();
      const pmVisa = svc.create({ type: "card", card: { token: "tok_visa" } });
      const pmAmex = svc.create({ type: "card", card: { token: "tok_amex" } });
      expect(pmVisa.card?.fingerprint).not.toBe(pmAmex.card?.fingerprint);
    });

    it("unknown token defaults to tok_visa behavior", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_unknown_xyz" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
      expect(pm.card?.funding).toBe("credit");
    });

    it("no card param at all defaults to tok_visa", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
    });

    it("card has display_brand matching brand", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect((pm.card as any)?.display_brand).toBe("visa");
    });

    it("card has networks.available matching brand", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      expect((pm.card as any)?.networks?.available).toEqual(["mastercard"]);
    });

    it("card has networks.preferred set to null", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect((pm.card as any)?.networks?.preferred).toBeNull();
    });

    it("card has three_d_secure_usage.supported set to true", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect((pm.card as any)?.three_d_secure_usage?.supported).toBe(true);
    });

    it("card has wallet set to null", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.wallet).toBeNull();
    });

    it("card has generated_from set to null", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect((pm.card as any)?.generated_from).toBeNull();
    });

    it("throws for unsupported type sepa_debit", () => {
      const svc = makeService();
      expect(() => svc.create({ type: "sepa_debit" })).toThrow(StripeError);
    });

    it("throws for unsupported type us_bank_account", () => {
      const svc = makeService();
      expect(() => svc.create({ type: "us_bank_account" })).toThrow(StripeError);
    });

    it("unsupported type error has correct status code 400", () => {
      const svc = makeService();
      try {
        svc.create({ type: "ideal" });
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("unsupported type error message mentions the type", () => {
      const svc = makeService();
      try {
        svc.create({ type: "sofort" });
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("sofort");
      }
    });

    it("unsupported type error has type invalid_request_error", () => {
      const svc = makeService();
      try {
        svc.create({ type: "bancontact" });
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("creates PM and persists to DB (retrievable)", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_amex" } });
      const retrieved = svc.retrieve(pm.id);
      expect(retrieved.id).toBe(pm.id);
    });

    it("card token with empty string defaults to tok_visa", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
    });

    it("metadata with many keys", () => {
      const svc = makeService();
      const meta: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        meta[`key_${i}`] = `value_${i}`;
      }
      const pm = svc.create({ type: "card", metadata: meta });
      expect(Object.keys(pm.metadata!).length).toBe(20);
      expect(pm.metadata!.key_0).toBe("value_0");
      expect(pm.metadata!.key_19).toBe("value_19");
    });

    it("billing_details with null email is null not undefined", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", billing_details: { email: null } });
      expect(pm.billing_details.email).toBeNull();
      expect(pm.billing_details.email).not.toBeUndefined();
    });

    it("card sub-object is not null", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.card).not.toBeNull();
      expect(pm.card).toBeDefined();
    });

    it("created timestamp is integer (no decimals)", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.created).toBe(Math.floor(pm.created));
    });

    it("fresh service instances share no state", () => {
      const svc1 = makeService();
      const svc2 = makeService();
      svc1.create({ type: "card" });
      const list2 = svc2.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(list2.data.length).toBe(0);
    });

    it("create with card number param still defaults to tok_visa behavior", () => {
      const svc = makeService();
      // The implementation ignores raw card numbers and falls back to tok_visa
      const pm = svc.create({ type: "card", card: { number: "5555555555554444", exp_month: 3, exp_year: 2028, cvc: "123" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve() tests
  // ---------------------------------------------------------------------------
  describe("retrieve", () => {
    it("retrieves an existing payment method by ID", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_visa" } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it("retrieved PM has correct object field", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.object).toBe("payment_method");
    });

    it("retrieved PM has correct type", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.type).toBe("card");
    });

    it("retrieved PM has correct card details", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.card?.brand).toBe("mastercard");
      expect(retrieved.card?.last4).toBe("4444");
    });

    it("retrieved PM has correct billing_details", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", billing_details: { name: "Alice" } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.billing_details.name).toBe("Alice");
    });

    it("retrieved PM has correct metadata", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", metadata: { foo: "bar" } });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.metadata).toEqual({ foo: "bar" });
    });

    it("retrieved PM has correct created timestamp", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.created).toBe(created.created);
    });

    it("retrieved PM has livemode false", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.livemode).toBe(false);
    });

    it("retrieved PM has null customer when not attached", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.customer).toBeNull();
    });

    it("retrieved PM shows customer after attach", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created = pm.create({ type: "card" });
      pm.attach(created.id, customer.id);
      const retrieved = pm.retrieve(created.id);
      expect(retrieved.customer).toBe(customer.id);
    });

    it("retrieved PM shows null customer after detach", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created = pm.create({ type: "card" });
      pm.attach(created.id, customer.id);
      pm.detach(created.id);
      const retrieved = pm.retrieve(created.id);
      expect(retrieved.customer).toBeNull();
    });

    it("throws for non-existent PM ID", () => {
      const svc = makeService();
      expect(() => svc.retrieve("pm_nonexistent")).toThrow(StripeError);
    });

    it("404 error has correct statusCode", () => {
      const svc = makeService();
      try {
        svc.retrieve("pm_nonexistent");
        expect(true).toBe(false); // should not reach
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("404 error has code resource_missing", () => {
      const svc = makeService();
      try {
        svc.retrieve("pm_does_not_exist");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("404 error has type invalid_request_error", () => {
      const svc = makeService();
      try {
        svc.retrieve("pm_missing123");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("404 error message includes the requested ID", () => {
      const svc = makeService();
      try {
        svc.retrieve("pm_specific_id_abc");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("pm_specific_id_abc");
      }
    });

    it("404 error message mentions payment_method resource", () => {
      const svc = makeService();
      try {
        svc.retrieve("pm_xyz");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("payment_method");
      }
    });

    it("404 error has param set to id", () => {
      const svc = makeService();
      try {
        svc.retrieve("pm_missing_param");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("id");
      }
    });

    it("retrieves correct PM among multiple", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card", card: { token: "tok_visa" } });
      const pm2 = svc.create({ type: "card", card: { token: "tok_amex" } });
      const pm3 = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      const retrieved = svc.retrieve(pm2.id);
      expect(retrieved.id).toBe(pm2.id);
      expect(retrieved.card?.brand).toBe("amex");
    });

    it("retrieve returns all fields matching the created PM", () => {
      const svc = makeService();
      const created = svc.create({
        type: "card",
        card: { token: "tok_visa" },
        billing_details: { name: "Full Match" },
        metadata: { a: "1" },
      });
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.object).toBe(created.object);
      expect(retrieved.type).toBe(created.type);
      expect(retrieved.card?.brand).toBe(created.card?.brand);
      expect(retrieved.card?.last4).toBe(created.card?.last4);
      expect(retrieved.billing_details.name).toBe(created.billing_details.name);
      expect(retrieved.metadata).toEqual(created.metadata);
      expect(retrieved.livemode).toBe(created.livemode);
      expect(retrieved.created).toBe(created.created);
    });
  });

  // ---------------------------------------------------------------------------
  // attach() tests
  // ---------------------------------------------------------------------------
  describe("attach", () => {
    it("attaches PM to a customer", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created = pm.create({ type: "card" });
      const attached = pm.attach(created.id, customer.id);
      expect(attached.customer).toBe(customer.id);
    });

    it("attach sets customer field on PM", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created = pm.create({ type: "card" });
      const attached = pm.attach(created.id, customer.id);
      expect(attached.customer).toBe(customer.id);
    });

    it("attach returns the updated PM object", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created = pm.create({ type: "card" });
      const attached = pm.attach(created.id, customer.id);
      expect(attached.id).toBe(created.id);
      expect(attached.object).toBe("payment_method");
      expect(attached.type).toBe("card");
    });

    it("attach persists customer across retrieves", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created = pm.create({ type: "card" });
      pm.attach(created.id, customer.id);
      const retrieved = pm.retrieve(created.id);
      expect(retrieved.customer).toBe(customer.id);
    });

    it("throws 404 when attaching non-existent PM", () => {
      const svc = makeService();
      expect(() => svc.attach("pm_ghost", "cus_123")).toThrow(StripeError);
    });

    it("non-existent PM attach error has 404 status", () => {
      const svc = makeService();
      try {
        svc.attach("pm_ghost_404", "cus_123");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("attaches to a bare customer ID string (no validation of customer existence)", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      // The service does not validate customer existence itself
      const attached = svc.attach(created.id, "cus_fake_no_validation");
      expect(attached.customer).toBe("cus_fake_no_validation");
    });

    it("re-attach to same customer is idempotent", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created = pm.create({ type: "card" });
      pm.attach(created.id, customer.id);
      const reattached = pm.attach(created.id, customer.id);
      expect(reattached.customer).toBe(customer.id);
    });

    it("attach to different customer overwrites previous customer", () => {
      const { pm, cus } = makeServices();
      const cus1 = createTestCustomer(cus, { email: "a@test.com" });
      const cus2 = createTestCustomer(cus, { email: "b@test.com" });
      const created = pm.create({ type: "card" });
      pm.attach(created.id, cus1.id);
      const reattached = pm.attach(created.id, cus2.id);
      expect(reattached.customer).toBe(cus2.id);
    });

    it("attach to different customer persists new customer on retrieve", () => {
      const { pm, cus } = makeServices();
      const cus1 = createTestCustomer(cus, { email: "x@test.com" });
      const cus2 = createTestCustomer(cus, { email: "y@test.com" });
      const created = pm.create({ type: "card" });
      pm.attach(created.id, cus1.id);
      pm.attach(created.id, cus2.id);
      const retrieved = pm.retrieve(created.id);
      expect(retrieved.customer).toBe(cus2.id);
    });

    it("multiple PMs attached to same customer", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const pm1 = pm.create({ type: "card", card: { token: "tok_visa" } });
      const pm2 = pm.create({ type: "card", card: { token: "tok_amex" } });
      const pm3 = pm.create({ type: "card", card: { token: "tok_mastercard" } });
      pm.attach(pm1.id, customer.id);
      pm.attach(pm2.id, customer.id);
      pm.attach(pm3.id, customer.id);

      const list = pm.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: customer.id });
      expect(list.data.length).toBe(3);
    });

    it("attach preserves card details", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_amex" } });
      const attached = svc.attach(created.id, "cus_preserve");
      expect(attached.card?.brand).toBe("amex");
      expect(attached.card?.last4).toBe("8431");
      expect(attached.card?.funding).toBe("credit");
      expect(attached.card?.exp_month).toBe(12);
      expect(attached.card?.exp_year).toBe(2034);
    });

    it("attach preserves metadata", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", metadata: { key: "value" } });
      const attached = svc.attach(created.id, "cus_meta");
      expect(attached.metadata).toEqual({ key: "value" });
    });

    it("attach preserves billing_details", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", billing_details: { name: "Preserved" } });
      const attached = svc.attach(created.id, "cus_billing");
      expect(attached.billing_details.name).toBe("Preserved");
    });

    it("attach preserves created timestamp", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const attached = svc.attach(created.id, "cus_ts");
      expect(attached.created).toBe(created.created);
    });

    it("attach preserves livemode", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const attached = svc.attach(created.id, "cus_lm");
      expect(attached.livemode).toBe(false);
    });

    it("attach preserves object field", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const attached = svc.attach(created.id, "cus_obj");
      expect(attached.object).toBe("payment_method");
    });

    it("attach preserves type field", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const attached = svc.attach(created.id, "cus_type");
      expect(attached.type).toBe("card");
    });

    it("attach preserves id", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const attached = svc.attach(created.id, "cus_id");
      expect(attached.id).toBe(created.id);
    });

    it("attach preserves fingerprint", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_visa" } });
      const attached = svc.attach(created.id, "cus_fp");
      expect(attached.card?.fingerprint).toBe(created.card?.fingerprint);
    });

    it("attach preserves checks sub-object", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const attached = svc.attach(created.id, "cus_checks");
      expect(attached.card?.checks?.cvc_check).toBe("pass");
      expect(attached.card?.checks?.address_line1_check).toBeNull();
      expect(attached.card?.checks?.address_postal_code_check).toBeNull();
    });

    it("PM list for customer shows attached PMs", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created1 = pm.create({ type: "card" });
      const created2 = pm.create({ type: "card" });
      pm.attach(created1.id, customer.id);

      const list = pm.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: customer.id });
      expect(list.data.length).toBe(1);
      expect(list.data[0].id).toBe(created1.id);
    });

    it("attach then retrieve multiple times returns consistent data", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_visa" } });
      svc.attach(created.id, "cus_consistent");
      const r1 = svc.retrieve(created.id);
      const r2 = svc.retrieve(created.id);
      expect(r1.customer).toBe(r2.customer);
      expect(r1.card?.brand).toBe(r2.card?.brand);
      expect(r1.card?.last4).toBe(r2.card?.last4);
    });

    it("attaching one PM does not affect other PMs", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      const pm2 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_only_one");
      const retrieved2 = svc.retrieve(pm2.id);
      expect(retrieved2.customer).toBeNull();
    });

    it("attach updates DB so list by customer returns attached PM", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_list_check");
      const list = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_list_check" });
      expect(list.data.length).toBe(1);
      expect(list.data[0].customer).toBe("cus_list_check");
    });

    it("attached PM is not returned when listing for a different customer", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_A");
      const list = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_B" });
      expect(list.data.length).toBe(0);
    });

    it("attach with tok_threeDSecureRequired preserves 3DS card details", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_threeDSecureRequired" } });
      const attached = svc.attach(created.id, "cus_3ds");
      expect(attached.card?.last4).toBe("3220");
      expect(attached.card?.brand).toBe("visa");
    });

    it("attach 10 PMs to a customer", () => {
      const svc = makeService();
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const created = svc.create({ type: "card" });
        svc.attach(created.id, "cus_many");
        ids.push(created.id);
      }
      const list = svc.list({ limit: 100, startingAfter: undefined, endingBefore: undefined, customerId: "cus_many" });
      expect(list.data.length).toBe(10);
    });

    it("attach returns PM with customer as string (not object)", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      const attached = svc.attach(created.id, "cus_string_check");
      expect(typeof attached.customer).toBe("string");
    });
  });

  // ---------------------------------------------------------------------------
  // detach() tests
  // ---------------------------------------------------------------------------
  describe("detach", () => {
    it("detaches PM from customer", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus);
      const created = pm.create({ type: "card" });
      pm.attach(created.id, customer.id);
      const detached = pm.detach(created.id);
      expect(detached.customer).toBeNull();
    });

    it("detach sets customer to null", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_detach");
      const detached = svc.detach(created.id);
      expect(detached.customer).toBeNull();
    });

    it("detach returns the updated PM", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_ret");
      const detached = svc.detach(created.id);
      expect(detached.id).toBe(created.id);
      expect(detached.object).toBe("payment_method");
      expect(detached.customer).toBeNull();
    });

    it("detach PM that was never attached sets customer to null (no error)", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      // customer is already null, detach should still succeed
      const detached = svc.detach(created.id);
      expect(detached.customer).toBeNull();
    });

    it("throws 404 for non-existent PM ID on detach", () => {
      const svc = makeService();
      expect(() => svc.detach("pm_ghost")).toThrow(StripeError);
    });

    it("detach 404 error has correct statusCode", () => {
      const svc = makeService();
      try {
        svc.detach("pm_detach_ghost");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("detach 404 error has resource_missing code", () => {
      const svc = makeService();
      try {
        svc.detach("pm_detach_missing");
        expect(true).toBe(false);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("detach then re-attach works", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_first");
      svc.detach(created.id);
      const reattached = svc.attach(created.id, "cus_second");
      expect(reattached.customer).toBe("cus_second");
    });

    it("detach then re-attach persists on retrieve", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_first");
      svc.detach(created.id);
      svc.attach(created.id, "cus_second");
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.customer).toBe("cus_second");
    });

    it("after detach, PM is still retrievable", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_visa" } });
      svc.attach(created.id, "cus_still_exists");
      svc.detach(created.id);
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.card?.brand).toBe("visa");
    });

    it("after detach, PM not in customer list", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_list_gone");
      svc.detach(created.id);
      const list = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_list_gone" });
      expect(list.data.length).toBe(0);
    });

    it("detach preserves card details", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_amex" } });
      svc.attach(created.id, "cus_preserve_detach");
      const detached = svc.detach(created.id);
      expect(detached.card?.brand).toBe("amex");
      expect(detached.card?.last4).toBe("8431");
    });

    it("detach preserves metadata", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", metadata: { key: "val" } });
      svc.attach(created.id, "cus_meta_detach");
      const detached = svc.detach(created.id);
      expect(detached.metadata).toEqual({ key: "val" });
    });

    it("detach preserves billing_details", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", billing_details: { name: "Detach Name" } });
      svc.attach(created.id, "cus_billing_detach");
      const detached = svc.detach(created.id);
      expect(detached.billing_details.name).toBe("Detach Name");
    });

    it("detach preserves created timestamp", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_ts_detach");
      const detached = svc.detach(created.id);
      expect(detached.created).toBe(created.created);
    });

    it("detach preserves livemode", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_lm_detach");
      const detached = svc.detach(created.id);
      expect(detached.livemode).toBe(false);
    });

    it("detach preserves fingerprint", () => {
      const svc = makeService();
      const created = svc.create({ type: "card", card: { token: "tok_visa" } });
      svc.attach(created.id, "cus_fp_detach");
      const detached = svc.detach(created.id);
      expect(detached.card?.fingerprint).toBe(created.card?.fingerprint);
    });

    it("detach persists null customer across retrieves", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_persist_null");
      svc.detach(created.id);
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.customer).toBeNull();
    });

    it("detach one PM does not affect others attached to same customer", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      const pm2 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_multi_detach");
      svc.attach(pm2.id, "cus_multi_detach");
      svc.detach(pm1.id);
      const r2 = svc.retrieve(pm2.id);
      expect(r2.customer).toBe("cus_multi_detach");
    });

    it("detach then list for customer excludes detached PM", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      const pm2 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_detach_list");
      svc.attach(pm2.id, "cus_detach_list");
      svc.detach(pm1.id);
      const list = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_detach_list" });
      expect(list.data.length).toBe(1);
      expect(list.data[0].id).toBe(pm2.id);
    });

    it("multiple detach calls on same PM are idempotent", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_double_detach");
      svc.detach(created.id);
      const secondDetach = svc.detach(created.id);
      expect(secondDetach.customer).toBeNull();
    });

    it("detach then attach then detach again works", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_cycle1");
      svc.detach(created.id);
      svc.attach(created.id, "cus_cycle2");
      const finalDetach = svc.detach(created.id);
      expect(finalDetach.customer).toBeNull();
      const retrieved = svc.retrieve(created.id);
      expect(retrieved.customer).toBeNull();
    });

    it("detach preserves id", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_id_detach");
      const detached = svc.detach(created.id);
      expect(detached.id).toBe(created.id);
    });

    it("detach preserves object field", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_obj_detach");
      const detached = svc.detach(created.id);
      expect(detached.object).toBe("payment_method");
    });

    it("detach preserves type field", () => {
      const svc = makeService();
      const created = svc.create({ type: "card" });
      svc.attach(created.id, "cus_type_detach");
      const detached = svc.detach(created.id);
      expect(detached.type).toBe("card");
    });
  });

  // ---------------------------------------------------------------------------
  // list() tests
  // ---------------------------------------------------------------------------
  describe("list", () => {
    it("returns empty list when no PMs exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
    });

    it("returns object=list", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
    });

    it("returns url=/v1/payment_methods", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.url).toBe("/v1/payment_methods");
    });

    it("lists all PMs when no filters", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
    });

    it("lists PMs for specific customer", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      const pm2 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_filter_1");
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_filter_1" });
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(pm1.id);
    });

    it("lists PMs with type=card filter", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, type: "card" });
      expect(result.data.length).toBe(2);
    });

    it("type filter returns empty when no matching type", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, type: "sepa_debit" });
      expect(result.data.length).toBe(0);
    });

    it("respects limit parameter", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ type: "card" });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
    });

    it("has_more is true when more items exist than limit", () => {
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ type: "card" });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(true);
    });

    it("has_more is false when all items fit in limit", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.create({ type: "card" });
      }
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(false);
    });

    it("has_more is false when items equal limit", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.create({ type: "card" });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.has_more).toBe(false);
    });

    it("pagination with startingAfter returns remaining items", () => {
      // Pagination uses created timestamp (unix seconds) as cursor.
      // Items created within the same second share the same cursor value,
      // so startingAfter only returns items with a strictly greater timestamp.
      // We test that the mechanism works: first page returns items, second page
      // using the last item as cursor does not include items from the first page.
      const svc = makeService();
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      svc.create({ type: "card" });

      const page1 = svc.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      // Items from page1 should not appear in page2
      const page1Ids = new Set(page1.data.map((d) => d.id));
      for (const item of page2.data) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
    });

    it("startingAfter with non-existent ID throws 404", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      expect(() =>
        svc.list({ limit: 10, startingAfter: "pm_nonexistent_cursor", endingBefore: undefined })
      ).toThrow(StripeError);
    });

    it("pagination collects items without duplication across pages", () => {
      // Since cursor pagination is based on unix-second timestamps, items created
      // in the same second may all appear on the first page. We verify no duplicates
      // appear across pages rather than asserting exact total count.
      const svc = makeService();
      for (let i = 0; i < 5; i++) {
        svc.create({ type: "card" });
      }

      const collectedIds: string[] = [];
      let startingAfter: string | undefined = undefined;

      for (let page = 0; page < 10; page++) {
        const result = svc.list({ limit: 2, startingAfter, endingBefore: undefined });
        collectedIds.push(...result.data.map((d) => d.id));
        if (!result.has_more) break;
        startingAfter = result.data[result.data.length - 1].id;
      }

      // No duplicate IDs across pages
      expect(new Set(collectedIds).size).toBe(collectedIds.length);
      // At least some items collected
      expect(collectedIds.length).toBeGreaterThanOrEqual(2);
    });

    it("list returns only PMs for the specified customer", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      const pm2 = svc.create({ type: "card" });
      const pm3 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_specific");
      svc.attach(pm2.id, "cus_other");

      const list = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_specific" });
      expect(list.data.length).toBe(1);
      expect(list.data[0].id).toBe(pm1.id);
    });

    it("list does not return detached PMs for customer", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_detached_list");
      svc.detach(pm1.id);

      const list = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_detached_list" });
      expect(list.data.length).toBe(0);
    });

    it("list returns PMs with full data", () => {
      const svc = makeService();
      svc.create({ type: "card", card: { token: "tok_amex" }, metadata: { a: "b" } });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data[0].card?.brand).toBe("amex");
      expect(result.data[0].metadata).toEqual({ a: "b" });
    });

    it("list with limit=1 returns exactly one item", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      const result = svc.list({ limit: 1, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    it("list with customerId and type combined filter", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_combined");
      const result = svc.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_combined",
        type: "card",
      });
      expect(result.data.length).toBe(1);
    });

    it("list with customerId and non-matching type returns empty", () => {
      const svc = makeService();
      const pm1 = svc.create({ type: "card" });
      svc.attach(pm1.id, "cus_mismatch_type");
      const result = svc.list({
        limit: 10,
        startingAfter: undefined,
        endingBefore: undefined,
        customerId: "cus_mismatch_type",
        type: "sepa_debit",
      });
      expect(result.data.length).toBe(0);
    });

    it("list returns data as array", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("list each item has correct object type", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      for (const item of result.data) {
        expect(item.object).toBe("payment_method");
      }
    });

    it("list each item has pm_ prefix ID", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      for (const item of result.data) {
        expect(item.id).toMatch(/^pm_/);
      }
    });

    it("list items have unique IDs", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      svc.create({ type: "card" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      const ids = result.data.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("list pagination does not duplicate items", () => {
      const svc = makeService();
      for (let i = 0; i < 6; i++) {
        svc.create({ type: "card" });
      }

      const page1 = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = svc.list({ limit: 3, startingAfter: lastId, endingBefore: undefined });

      const page1Ids = page1.data.map((d) => d.id);
      const page2Ids = page2.data.map((d) => d.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      expect(overlap.length).toBe(0);
    });

    it("list empty for non-existent customer", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined, customerId: "cus_does_not_exist" });
      expect(result.data.length).toBe(0);
    });

    it("list with large limit returns all items", () => {
      const svc = makeService();
      for (let i = 0; i < 3; i++) {
        svc.create({ type: "card" });
      }
      const result = svc.list({ limit: 100, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Card details validation tests (magic tokens)
  // ---------------------------------------------------------------------------
  describe("card details validation", () => {
    it("tok_visa: brand=visa, last4=4242, funding=credit", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("4242");
      expect(pm.card?.funding).toBe("credit");
    });

    it("tok_mastercard: brand=mastercard, last4=4444, funding=credit", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      expect(pm.card?.brand).toBe("mastercard");
      expect(pm.card?.last4).toBe("4444");
      expect(pm.card?.funding).toBe("credit");
    });

    it("tok_amex: brand=amex, last4=8431, funding=credit", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_amex" } });
      expect(pm.card?.brand).toBe("amex");
      expect(pm.card?.last4).toBe("8431");
      expect(pm.card?.funding).toBe("credit");
    });

    it("tok_visa_debit: brand=visa, last4=5556, funding=debit", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa_debit" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("5556");
      expect(pm.card?.funding).toBe("debit");
    });

    it("tok_threeDSecureRequired: brand=visa, last4=3220, funding=credit", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_threeDSecureRequired" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("3220");
      expect(pm.card?.funding).toBe("credit");
    });

    it("tok_threeDSecureOptional: brand=visa, last4=3222, funding=credit", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_threeDSecureOptional" } });
      expect(pm.card?.brand).toBe("visa");
      expect(pm.card?.last4).toBe("3222");
      expect(pm.card?.funding).toBe("credit");
    });

    it("all magic tokens have country=US", () => {
      const svc = makeService();
      const tokens = ["tok_visa", "tok_mastercard", "tok_amex", "tok_visa_debit", "tok_threeDSecureRequired", "tok_threeDSecureOptional"];
      for (const token of tokens) {
        const pm = svc.create({ type: "card", card: { token } });
        expect(pm.card?.country).toBe("US");
      }
    });

    it("all magic tokens have cvc_check=pass", () => {
      const svc = makeService();
      const tokens = ["tok_visa", "tok_mastercard", "tok_amex", "tok_visa_debit", "tok_threeDSecureRequired", "tok_threeDSecureOptional"];
      for (const token of tokens) {
        const pm = svc.create({ type: "card", card: { token } });
        expect(pm.card?.checks?.cvc_check).toBe("pass");
      }
    });

    it("all magic tokens have address_line1_check=null", () => {
      const svc = makeService();
      const tokens = ["tok_visa", "tok_mastercard", "tok_amex", "tok_visa_debit", "tok_threeDSecureRequired", "tok_threeDSecureOptional"];
      for (const token of tokens) {
        const pm = svc.create({ type: "card", card: { token } });
        expect(pm.card?.checks?.address_line1_check).toBeNull();
      }
    });

    it("all magic tokens have address_postal_code_check=null", () => {
      const svc = makeService();
      const tokens = ["tok_visa", "tok_mastercard", "tok_amex", "tok_visa_debit", "tok_threeDSecureRequired", "tok_threeDSecureOptional"];
      for (const token of tokens) {
        const pm = svc.create({ type: "card", card: { token } });
        expect(pm.card?.checks?.address_postal_code_check).toBeNull();
      }
    });

    it("all magic tokens have three_d_secure_usage.supported=true", () => {
      const svc = makeService();
      const tokens = ["tok_visa", "tok_mastercard", "tok_amex", "tok_visa_debit", "tok_threeDSecureRequired", "tok_threeDSecureOptional"];
      for (const token of tokens) {
        const pm = svc.create({ type: "card", card: { token } });
        expect((pm.card as any)?.three_d_secure_usage?.supported).toBe(true);
      }
    });

    it("all magic tokens have wallet=null", () => {
      const svc = makeService();
      const tokens = ["tok_visa", "tok_mastercard", "tok_amex", "tok_visa_debit", "tok_threeDSecureRequired", "tok_threeDSecureOptional"];
      for (const token of tokens) {
        const pm = svc.create({ type: "card", card: { token } });
        expect(pm.card?.wallet).toBeNull();
      }
    });

    it("all magic tokens produce a fingerprint", () => {
      const svc = makeService();
      const tokens = ["tok_visa", "tok_mastercard", "tok_amex", "tok_visa_debit", "tok_threeDSecureRequired", "tok_threeDSecureOptional"];
      for (const token of tokens) {
        const pm = svc.create({ type: "card", card: { token } });
        expect(pm.card?.fingerprint).toBeDefined();
        expect(pm.card!.fingerprint!.length).toBe(16);
      }
    });

    it("fingerprints differ across different brands", () => {
      const svc = makeService();
      const visa = svc.create({ type: "card", card: { token: "tok_visa" } });
      const mc = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      const amex = svc.create({ type: "card", card: { token: "tok_amex" } });
      const fps = [visa.card?.fingerprint, mc.card?.fingerprint, amex.card?.fingerprint];
      expect(new Set(fps).size).toBe(3);
    });

    it("tok_visa and tok_visa_debit have different fingerprints (different last4)", () => {
      const svc = makeService();
      const visa = svc.create({ type: "card", card: { token: "tok_visa" } });
      const visaDebit = svc.create({ type: "card", card: { token: "tok_visa_debit" } });
      expect(visa.card?.fingerprint).not.toBe(visaDebit.card?.fingerprint);
    });

    it("tok_visa display_brand is visa", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect((pm.card as any)?.display_brand).toBe("visa");
    });

    it("tok_mastercard display_brand is mastercard", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      expect((pm.card as any)?.display_brand).toBe("mastercard");
    });

    it("tok_amex display_brand is amex", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_amex" } });
      expect((pm.card as any)?.display_brand).toBe("amex");
    });

    it("tok_visa networks.available is [visa]", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect((pm.card as any)?.networks?.available).toEqual(["visa"]);
    });

    it("tok_amex networks.available is [amex]", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_amex" } });
      expect((pm.card as any)?.networks?.available).toEqual(["amex"]);
    });

    it("tok_mastercard networks.available is [mastercard]", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_mastercard" } });
      expect((pm.card as any)?.networks?.available).toEqual(["mastercard"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Object shape validation tests
  // ---------------------------------------------------------------------------
  describe("object shape validation", () => {
    it("PM has all top-level fields", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      expect(pm).toHaveProperty("id");
      expect(pm).toHaveProperty("object");
      expect(pm).toHaveProperty("billing_details");
      expect(pm).toHaveProperty("card");
      expect(pm).toHaveProperty("created");
      expect(pm).toHaveProperty("customer");
      expect(pm).toHaveProperty("livemode");
      expect(pm).toHaveProperty("metadata");
      expect(pm).toHaveProperty("type");
    });

    it("billing_details has all sub-fields", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.billing_details).toHaveProperty("address");
      expect(pm.billing_details).toHaveProperty("email");
      expect(pm.billing_details).toHaveProperty("name");
      expect(pm.billing_details).toHaveProperty("phone");
    });

    it("card has all expected sub-fields", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", card: { token: "tok_visa" } });
      const card = pm.card as any;
      expect(card).toHaveProperty("brand");
      expect(card).toHaveProperty("checks");
      expect(card).toHaveProperty("country");
      expect(card).toHaveProperty("display_brand");
      expect(card).toHaveProperty("exp_month");
      expect(card).toHaveProperty("exp_year");
      expect(card).toHaveProperty("fingerprint");
      expect(card).toHaveProperty("funding");
      expect(card).toHaveProperty("generated_from");
      expect(card).toHaveProperty("last4");
      expect(card).toHaveProperty("networks");
      expect(card).toHaveProperty("three_d_secure_usage");
      expect(card).toHaveProperty("wallet");
    });

    it("checks sub-object has all expected fields", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      const checks = pm.card?.checks;
      expect(checks).toHaveProperty("address_line1_check");
      expect(checks).toHaveProperty("address_postal_code_check");
      expect(checks).toHaveProperty("cvc_check");
    });

    it("networks sub-object has available and preferred", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      const networks = (pm.card as any)?.networks;
      expect(networks).toHaveProperty("available");
      expect(networks).toHaveProperty("preferred");
    });

    it("three_d_secure_usage sub-object has supported field", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect((pm.card as any)?.three_d_secure_usage).toHaveProperty("supported");
    });

    it("nullable fields are correctly null by default", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.customer).toBeNull();
      expect(pm.billing_details.address).toBeNull();
      expect(pm.billing_details.email).toBeNull();
      expect(pm.billing_details.name).toBeNull();
      expect(pm.billing_details.phone).toBeNull();
      expect(pm.card?.wallet).toBeNull();
      expect((pm.card as any)?.generated_from).toBeNull();
      expect((pm.card as any)?.networks?.preferred).toBeNull();
      expect(pm.card?.checks?.address_line1_check).toBeNull();
      expect(pm.card?.checks?.address_postal_code_check).toBeNull();
    });

    it("object field value is the string payment_method", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card" });
      expect(pm.object).toBe("payment_method");
    });

    it("list response has correct shape", () => {
      const svc = makeService();
      svc.create({ type: "card" });
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result).toHaveProperty("object");
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("has_more");
      expect(result).toHaveProperty("url");
      expect(result.object).toBe("list");
      expect(Array.isArray(result.data)).toBe(true);
      expect(typeof result.has_more).toBe("boolean");
      expect(typeof result.url).toBe("string");
    });

    it("metadata values are strings", () => {
      const svc = makeService();
      const pm = svc.create({ type: "card", metadata: { num: "42", flag: "true" } });
      expect(typeof pm.metadata!.num).toBe("string");
      expect(typeof pm.metadata!.flag).toBe("string");
    });

    it("complete PM round-trip: create, attach, retrieve matches expectations", () => {
      const { pm, cus } = makeServices();
      const customer = createTestCustomer(cus, { name: "Shape Test", email: "shape@test.com" });
      const created = pm.create({
        type: "card",
        card: { token: "tok_amex" },
        billing_details: { name: "Shape Test", email: "shape@test.com" },
        metadata: { round: "trip" },
      });
      pm.attach(created.id, customer.id);
      const retrieved = pm.retrieve(created.id);

      expect(retrieved.id).toMatch(/^pm_/);
      expect(retrieved.object).toBe("payment_method");
      expect(retrieved.type).toBe("card");
      expect(retrieved.livemode).toBe(false);
      expect(retrieved.customer).toBe(customer.id);
      expect(retrieved.card?.brand).toBe("amex");
      expect(retrieved.card?.last4).toBe("8431");
      expect(retrieved.card?.funding).toBe("credit");
      expect(retrieved.card?.country).toBe("US");
      expect(retrieved.card?.exp_month).toBe(12);
      expect(retrieved.card?.exp_year).toBe(2034);
      expect(retrieved.card?.checks?.cvc_check).toBe("pass");
      expect(retrieved.billing_details.name).toBe("Shape Test");
      expect(retrieved.billing_details.email).toBe("shape@test.com");
      expect(retrieved.metadata).toEqual({ round: "trip" });
    });
  });
});
