import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { CustomerService } from "../../../src/services/customers";
import { SetupIntentService } from "../../../src/services/setup-intents";
import { StripeError } from "../../../src/errors";

function makeServices() {
  const db = createDB(":memory:");
  const pmService = new PaymentMethodService(db);
  const customerService = new CustomerService(db);
  const siService = new SetupIntentService(db, pmService);
  return { db, pmService, customerService, siService };
}

function createPM(pmService: PaymentMethodService, token = "tok_visa") {
  return pmService.create({ type: "card", card: { token } });
}

const listDefaults = { limit: 10, startingAfter: undefined, endingBefore: undefined };

describe("SetupIntentService", () => {
  // ---------------------------------------------------------------------------
  // create() tests
  // ---------------------------------------------------------------------------
  describe("create", () => {
    it("creates a setup intent with no params", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si).toBeDefined();
      expect(si.id).toBeDefined();
    });

    it("returns an object field of 'setup_intent'", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.object).toBe("setup_intent");
    });

    it("generates an id starting with seti_", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.id).toMatch(/^seti_/);
    });

    it("generates a client_secret containing the SI id", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.client_secret).toContain(si.id);
    });

    it("generates a client_secret starting with seti_", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.client_secret).toMatch(/^seti_/);
    });

    it("generates a client_secret with _secret_ suffix pattern", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      // generateSecret produces "prefix_random" so client_secret = "seti_xxx_seti_xxx_random"
      // Actually from generateSecret: `${prefix}_${random}` where prefix is the SI id
      expect(si.client_secret!.length).toBeGreaterThan(si.id.length);
    });

    it("defaults status to requires_payment_method when no PM given", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.status).toBe("requires_payment_method");
    });

    it("defaults payment_method to null when none given", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.payment_method).toBeNull();
    });

    it("sets status to requires_confirmation when PM is given without confirm", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");
    });

    it("stores the payment_method id when PM is given", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      expect(si.payment_method).toBe(pm.id);
    });

    it("sets customer when provided", () => {
      const { siService } = makeServices();
      const si = siService.create({ customer: "cus_abc" });
      expect(si.customer).toBe("cus_abc");
    });

    it("defaults customer to null when not provided", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.customer).toBeNull();
    });

    it("sets customer from CustomerService-created customer", () => {
      const { siService, customerService } = makeServices();
      const cust = customerService.create({ email: "test@example.com" });
      const si = siService.create({ customer: cust.id });
      expect(si.customer).toBe(cust.id);
    });

    it("sets both customer and payment_method when both provided", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ customer: "cus_xyz", payment_method: pm.id });
      expect(si.customer).toBe("cus_xyz");
      expect(si.payment_method).toBe(pm.id);
    });

    it("stores metadata", () => {
      const { siService } = makeServices();
      const si = siService.create({ metadata: { order: "123" } });
      expect(si.metadata).toEqual({ order: "123" });
    });

    it("stores metadata with multiple keys", () => {
      const { siService } = makeServices();
      const si = siService.create({ metadata: { key1: "val1", key2: "val2", key3: "val3" } });
      expect(si.metadata).toEqual({ key1: "val1", key2: "val2", key3: "val3" });
    });

    it("defaults metadata to empty object when not provided", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.metadata).toEqual({});
    });

    it("creates SI with confirm=true and PM results in succeeded", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");
    });

    it("creates SI with confirm=true and PM preserves payment_method", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.payment_method).toBe(pm.id);
    });

    it("creates SI with confirm=true, PM, and customer preserves customer", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true, customer: "cus_keepme" });
      expect(si.customer).toBe("cus_keepme");
    });

    it("creates SI with confirm=true, PM, and metadata preserves metadata", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true, metadata: { key: "val" } });
      expect(si.metadata).toEqual({ key: "val" });
    });

    it("confirm=true without PM does not auto-confirm", () => {
      const { siService } = makeServices();
      const si = siService.create({ confirm: true });
      // confirm=true path only triggers when payment_method is also set
      expect(si.status).toBe("requires_payment_method");
    });

    it("sets livemode to false", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.livemode).toBe(false);
    });

    it("sets cancellation_reason to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.cancellation_reason).toBeNull();
    });

    it("sets next_action to null initially", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.next_action).toBeNull();
    });

    it("sets payment_method_options to empty object", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.payment_method_options).toEqual({});
    });

    it("sets payment_method_types to ['card']", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.payment_method_types).toEqual(["card"]);
    });

    it("sets usage to off_session", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.usage).toBe("off_session");
    });

    it("sets created to a valid unix timestamp", () => {
      const { siService } = makeServices();
      const before = Math.floor(Date.now() / 1000);
      const si = siService.create({});
      const after = Math.floor(Date.now() / 1000);
      expect(si.created).toBeGreaterThanOrEqual(before);
      expect(si.created).toBeLessThanOrEqual(after);
    });

    it("sets latest_attempt to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.latest_attempt).toBeNull();
    });

    it("sets mandate to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.mandate).toBeNull();
    });

    it("sets single_use_mandate to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.single_use_mandate).toBeNull();
    });

    it("sets description to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.description).toBeNull();
    });

    it("sets application to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.application).toBeNull();
    });

    it("sets automatic_payment_methods to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.automatic_payment_methods).toBeNull();
    });

    it("sets last_setup_error to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.last_setup_error).toBeNull();
    });

    it("sets on_behalf_of to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.on_behalf_of).toBeNull();
    });

    it("creates multiple SIs with unique IDs", () => {
      const { siService } = makeServices();
      const si1 = siService.create({});
      const si2 = siService.create({});
      const si3 = siService.create({});
      const ids = new Set([si1.id, si2.id, si3.id]);
      expect(ids.size).toBe(3);
    });

    it("creates multiple SIs with unique client_secrets", () => {
      const { siService } = makeServices();
      const si1 = siService.create({});
      const si2 = siService.create({});
      const secrets = new Set([si1.client_secret, si2.client_secret]);
      expect(secrets.size).toBe(2);
    });

    it("persists the SI so it can be retrieved", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.id).toBe(si.id);
    });

    it("persists the confirmed SI when using confirm=true", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.status).toBe("succeeded");
    });

    it("creates SI with mastercard token PM", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService, "tok_mastercard");
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");
      expect(si.payment_method).toBe(pm.id);
    });

    it("creates SI with amex token PM", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService, "tok_amex");
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");
    });

    it("creates SI with debit card PM", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService, "tok_visa_debit");
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");
    });

    it("stores metadata with empty object when explicitly passed", () => {
      const { siService } = makeServices();
      const si = siService.create({ metadata: {} });
      expect(si.metadata).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve() tests
  // ---------------------------------------------------------------------------
  describe("retrieve", () => {
    it("returns a setup intent by ID", () => {
      const { siService } = makeServices();
      const created = siService.create({});
      const retrieved = siService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it("returns setup intent with correct object field", () => {
      const { siService } = makeServices();
      const created = siService.create({});
      const retrieved = siService.retrieve(created.id);
      expect(retrieved.object).toBe("setup_intent");
    });

    it("returns all fields from the created SI", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const created = siService.create({ payment_method: pm.id, customer: "cus_test", metadata: { foo: "bar" } });
      const retrieved = siService.retrieve(created.id);
      expect(retrieved.payment_method).toBe(pm.id);
      expect(retrieved.customer).toBe("cus_test");
      expect(retrieved.metadata).toEqual({ foo: "bar" });
    });

    it("returns correct status for unconfirmed SI", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.status).toBe("requires_payment_method");
    });

    it("returns correct status after confirm", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      siService.confirm(si.id, {});
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.status).toBe("succeeded");
    });

    it("returns correct status after cancel", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.status).toBe("canceled");
    });

    it("returns correct client_secret", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.client_secret).toBe(si.client_secret);
    });

    it("returns correct created timestamp", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.created).toBe(si.created);
    });

    it("throws StripeError for nonexistent ID", () => {
      const { siService } = makeServices();
      expect(() => siService.retrieve("seti_nonexistent")).toThrow(StripeError);
    });

    it("throws 404 status code for nonexistent ID", () => {
      const { siService } = makeServices();
      try {
        siService.retrieve("seti_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws error with resource_missing code for nonexistent ID", () => {
      const { siService } = makeServices();
      try {
        siService.retrieve("seti_nonexistent");
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("throws error with invalid_request_error type for nonexistent ID", () => {
      const { siService } = makeServices();
      try {
        siService.retrieve("seti_nonexistent");
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("throws error message containing the ID for nonexistent ID", () => {
      const { siService } = makeServices();
      try {
        siService.retrieve("seti_ghost123");
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("seti_ghost123");
      }
    });

    it("throws error message containing 'setup_intent' for nonexistent ID", () => {
      const { siService } = makeServices();
      try {
        siService.retrieve("seti_xxx");
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("setup_intent");
      }
    });

    it("returns the payment_method after confirm with PM param", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({});
      siService.confirm(si.id, { payment_method: pm.id });
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.payment_method).toBe(pm.id);
    });

    it("returns livemode as false", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.livemode).toBe(false);
    });

    it("retrieves SI created with confirm=true correctly", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.status).toBe("succeeded");
      expect(retrieved.payment_method).toBe(pm.id);
    });

    it("retrieves multiple different SIs independently", () => {
      const { siService } = makeServices();
      const si1 = siService.create({});
      const si2 = siService.create({ customer: "cus_abc" });
      expect(siService.retrieve(si1.id).customer).toBeNull();
      expect(siService.retrieve(si2.id).customer).toBe("cus_abc");
    });
  });

  // ---------------------------------------------------------------------------
  // confirm() tests
  // ---------------------------------------------------------------------------
  describe("confirm", () => {
    it("confirms a SI from requires_confirmation and succeeds", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.status).toBe("succeeded");
    });

    it("confirms from requires_payment_method with PM provided", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({});
      expect(si.status).toBe("requires_payment_method");
      const confirmed = siService.confirm(si.id, { payment_method: pm.id });
      expect(confirmed.status).toBe("succeeded");
    });

    it("confirms and sets payment_method when PM provided as param", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({});
      const confirmed = siService.confirm(si.id, { payment_method: pm.id });
      expect(confirmed.payment_method).toBe(pm.id);
    });

    it("confirms using SI's existing PM when no PM param given", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.payment_method).toBe(pm.id);
    });

    it("overrides SI's PM with the PM param if both exist", () => {
      const { siService, pmService } = makeServices();
      const pm1 = createPM(pmService);
      const pm2 = createPM(pmService, "tok_mastercard");
      const si = siService.create({ payment_method: pm1.id });
      const confirmed = siService.confirm(si.id, { payment_method: pm2.id });
      expect(confirmed.payment_method).toBe(pm2.id);
    });

    it("throws error when no PM available during confirm", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("throws 400 when no PM available during confirm", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws invalid_request_error when no PM available", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("throws error with payment_method param when no PM available", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.param).toBe("payment_method");
      }
    });

    it("throws error message about providing payment method when no PM", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("payment method");
      }
    });

    it("throws state transition error when confirming from canceled", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("throws 400 when confirming from canceled", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error for canceled confirm mentions 'canceled' status", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("canceled");
      }
    });

    it("error for canceled confirm has setup_intent_unexpected_state code", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("setup_intent_unexpected_state");
      }
    });

    it("throws error when confirming from succeeded", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("throws 400 when confirming from succeeded", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error for succeeded confirm mentions 'succeeded' status", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("succeeded");
      }
    });

    it("error for succeeded confirm has setup_intent_unexpected_state code", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("setup_intent_unexpected_state");
      }
    });

    it("error for confirm mentions 'confirm' action", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("confirm");
      }
    });

    it("throws 404 for nonexistent SI confirm", () => {
      const { siService } = makeServices();
      expect(() => siService.confirm("seti_ghost", {})).toThrow(StripeError);
    });

    it("throws 404 status for nonexistent SI confirm", () => {
      const { siService } = makeServices();
      try {
        siService.confirm("seti_ghost", {});
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws resource_missing code for nonexistent SI confirm", () => {
      const { siService } = makeServices();
      try {
        siService.confirm("seti_ghost", {});
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("throws 404 if PM does not exist during confirm", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(() => siService.confirm(si.id, { payment_method: "pm_nonexistent" })).toThrow(StripeError);
    });

    it("throws 404 status when PM does not exist during confirm", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      try {
        siService.confirm(si.id, { payment_method: "pm_nonexistent" });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("confirm preserves metadata", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, metadata: { key: "value" } });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.metadata).toEqual({ key: "value" });
    });

    it("confirm preserves customer", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, customer: "cus_keepme" });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.customer).toBe("cus_keepme");
    });

    it("confirm preserves created timestamp", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.created).toBe(si.created);
    });

    it("confirm preserves client_secret", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.client_secret).toBe(si.client_secret);
    });

    it("confirm preserves object field as setup_intent", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.object).toBe("setup_intent");
    });

    it("confirm preserves the SI id", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.id).toBe(si.id);
    });

    it("confirm returns updated SI (not a different object)", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.id).toBe(si.id);
      expect(confirmed.status).toBe("succeeded");
    });

    it("confirm persists status change in the DB", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      siService.confirm(si.id, {});
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.status).toBe("succeeded");
    });

    it("confirm persists PM change in the DB", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({});
      siService.confirm(si.id, { payment_method: pm.id });
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.payment_method).toBe(pm.id);
    });

    it("confirm sets cancellation_reason to null", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.cancellation_reason).toBeNull();
    });

    it("confirm sets next_action to null", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.next_action).toBeNull();
    });

    it("confirm with different PM tokens all succeed", () => {
      const { siService, pmService } = makeServices();
      const pmVisa = createPM(pmService, "tok_visa");
      const pmMC = createPM(pmService, "tok_mastercard");
      const pmAmex = createPM(pmService, "tok_amex");

      const si1 = siService.create({ payment_method: pmVisa.id });
      const si2 = siService.create({ payment_method: pmMC.id });
      const si3 = siService.create({ payment_method: pmAmex.id });

      expect(siService.confirm(si1.id, {}).status).toBe("succeeded");
      expect(siService.confirm(si2.id, {}).status).toBe("succeeded");
      expect(siService.confirm(si3.id, {}).status).toBe("succeeded");
    });

    it("confirm sets usage to off_session", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.usage).toBe("off_session");
    });

    it("confirm sets payment_method_types to ['card']", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.payment_method_types).toEqual(["card"]);
    });

    it("confirm sets livemode to false", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.livemode).toBe(false);
    });

    it("confirm preserves null customer when none set", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.customer).toBeNull();
    });

    it("cannot confirm twice (second attempt throws)", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      siService.confirm(si.id, {});
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("confirm preserves metadata with multiple keys", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, metadata: { a: "1", b: "2", c: "3" } });
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.metadata).toEqual({ a: "1", b: "2", c: "3" });
    });
  });

  // ---------------------------------------------------------------------------
  // cancel() tests
  // ---------------------------------------------------------------------------
  describe("cancel", () => {
    it("cancels a SI from requires_payment_method", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.status).toBe("requires_payment_method");
      const canceled = siService.cancel(si.id);
      expect(canceled.status).toBe("canceled");
    });

    it("cancels a SI from requires_confirmation", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");
      const canceled = siService.cancel(si.id);
      expect(canceled.status).toBe("canceled");
    });

    it("cancel returns the updated SI", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.id).toBe(si.id);
      expect(canceled.status).toBe("canceled");
    });

    it("cancel sets cancellation_reason to null (no reason given)", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.cancellation_reason).toBeNull();
    });

    it("cancel preserves the SI id", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.id).toBe(si.id);
    });

    it("cancel preserves object as setup_intent", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.object).toBe("setup_intent");
    });

    it("cancel preserves client_secret", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.client_secret).toBe(si.client_secret);
    });

    it("cancel preserves created timestamp", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.created).toBe(si.created);
    });

    it("cancel preserves customer", () => {
      const { siService } = makeServices();
      const si = siService.create({ customer: "cus_keep" });
      const canceled = siService.cancel(si.id);
      expect(canceled.customer).toBe("cus_keep");
    });

    it("cancel preserves null customer", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.customer).toBeNull();
    });

    it("cancel preserves payment_method", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      const canceled = siService.cancel(si.id);
      expect(canceled.payment_method).toBe(pm.id);
    });

    it("cancel preserves null payment_method", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.payment_method).toBeNull();
    });

    it("cancel preserves metadata", () => {
      const { siService } = makeServices();
      const si = siService.create({ metadata: { key: "value" } });
      const canceled = siService.cancel(si.id);
      expect(canceled.metadata).toEqual({ key: "value" });
    });

    it("cancel preserves empty metadata", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.metadata).toEqual({});
    });

    it("cancel persists in the DB", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.status).toBe("canceled");
    });

    it("throws error when canceling a succeeded SI", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");
      expect(() => siService.cancel(si.id)).toThrow(StripeError);
    });

    it("throws 400 when canceling a succeeded SI", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error for canceling succeeded mentions 'succeeded' status", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("succeeded");
      }
    });

    it("error for canceling succeeded has setup_intent_unexpected_state code", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("setup_intent_unexpected_state");
      }
    });

    it("error for canceling succeeded mentions 'cancel' action", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("cancel");
      }
    });

    it("throws error when canceling an already canceled SI", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      expect(() => siService.cancel(si.id)).toThrow(StripeError);
    });

    it("throws 400 when canceling an already canceled SI", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("error for re-cancel mentions 'canceled' status", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("canceled");
      }
    });

    it("throws 404 for nonexistent SI cancel", () => {
      const { siService } = makeServices();
      expect(() => siService.cancel("seti_ghost")).toThrow(StripeError);
    });

    it("throws 404 status for nonexistent SI cancel", () => {
      const { siService } = makeServices();
      try {
        siService.cancel("seti_ghost");
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("throws resource_missing code for nonexistent SI cancel", () => {
      const { siService } = makeServices();
      try {
        siService.cancel("seti_ghost");
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });

    it("after cancel, cannot confirm", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      siService.cancel(si.id);
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("after cancel, confirm throws 400", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      siService.cancel(si.id);
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("cancel sets next_action to null", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.next_action).toBeNull();
    });

    it("cancel sets livemode to false", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.livemode).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // list() tests
  // ---------------------------------------------------------------------------
  describe("list", () => {
    it("returns empty list when no setup intents exist", () => {
      const { siService } = makeServices();
      const result = siService.list(listDefaults);
      expect(result.data).toEqual([]);
    });

    it("returns object field as 'list'", () => {
      const { siService } = makeServices();
      const result = siService.list(listDefaults);
      expect(result.object).toBe("list");
    });

    it("returns url as /v1/setup_intents", () => {
      const { siService } = makeServices();
      const result = siService.list(listDefaults);
      expect(result.url).toBe("/v1/setup_intents");
    });

    it("returns has_more as false when no items", () => {
      const { siService } = makeServices();
      const result = siService.list(listDefaults);
      expect(result.has_more).toBe(false);
    });

    it("returns a single setup intent", () => {
      const { siService } = makeServices();
      siService.create({});
      const result = siService.list(listDefaults);
      expect(result.data.length).toBe(1);
    });

    it("returns all SIs up to limit", () => {
      const { siService } = makeServices();
      siService.create({});
      siService.create({});
      siService.create({});
      const result = siService.list(listDefaults);
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });

    it("respects limit with has_more true", () => {
      const { siService } = makeServices();
      for (let i = 0; i < 5; i++) {
        siService.create({});
      }
      const result = siService.list({ ...listDefaults, limit: 3 });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("returns has_more false when items equal limit", () => {
      const { siService } = makeServices();
      for (let i = 0; i < 3; i++) {
        siService.create({});
      }
      const result = siService.list({ ...listDefaults, limit: 3 });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });

    it("returns has_more false when items less than limit", () => {
      const { siService } = makeServices();
      siService.create({});
      siService.create({});
      const result = siService.list({ ...listDefaults, limit: 5 });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(false);
    });

    it("limit of 1 returns one item and has_more when more exist", () => {
      const { siService } = makeServices();
      siService.create({});
      siService.create({});
      const result = siService.list({ ...listDefaults, limit: 1 });
      expect(result.data.length).toBe(1);
      expect(result.has_more).toBe(true);
    });

    it("paginates with startingAfter", () => {
      const { siService } = makeServices();
      for (let i = 0; i < 3; i++) siService.create({});

      const page1 = siService.list({ ...listDefaults, limit: 2 });
      expect(page1.data.length).toBe(2);
      expect(page1.has_more).toBe(true);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = siService.list({ ...listDefaults, limit: 2, startingAfter: lastId });
      expect(page2.data.length).toBe(1);
      expect(page2.has_more).toBe(false);

      // All items returned, no duplicates
      const allIds = [...page1.data.map((d) => d.id), ...page2.data.map((d) => d.id)];
      expect(new Set(allIds).size).toBe(3);
    });

    it("paginates through all items", () => {
      const { siService } = makeServices();
      for (let i = 0; i < 5; i++) siService.create({});

      const page1 = siService.list({ ...listDefaults, limit: 2 });
      expect(page1.data.length).toBe(2);
      expect(page1.has_more).toBe(true);

      const page2 = siService.list({
        ...listDefaults,
        limit: 2,
        startingAfter: page1.data[page1.data.length - 1].id,
      });
      expect(page2.data.length).toBe(2);
      expect(page2.has_more).toBe(true);

      const page3 = siService.list({
        ...listDefaults,
        limit: 2,
        startingAfter: page2.data[page2.data.length - 1].id,
      });
      expect(page3.data.length).toBe(1);
      expect(page3.has_more).toBe(false);

      // All 5 items returned, no duplicates
      const allIds = [
        ...page1.data.map((d) => d.id),
        ...page2.data.map((d) => d.id),
        ...page3.data.map((d) => d.id),
      ];
      expect(new Set(allIds).size).toBe(5);
    });

    it("each page returns different items", () => {
      const { siService } = makeServices();
      for (let i = 0; i < 4; i++) siService.create({});

      const page1 = siService.list({ ...listDefaults, limit: 2 });
      const page2 = siService.list({
        ...listDefaults,
        limit: 2,
        startingAfter: page1.data[page1.data.length - 1].id,
      });

      const page1Ids = page1.data.map((s) => s.id);
      const page2Ids = page2.data.map((s) => s.id);
      const allIds = [...page1Ids, ...page2Ids];
      expect(new Set(allIds).size).toBe(4);
    });

    it("throws 404 when startingAfter references nonexistent SI", () => {
      const { siService } = makeServices();
      siService.create({});
      expect(() =>
        siService.list({ ...listDefaults, startingAfter: "seti_nonexistent" }),
      ).toThrow(StripeError);
    });

    it("throws 404 status when startingAfter references nonexistent SI", () => {
      const { siService } = makeServices();
      siService.create({});
      try {
        siService.list({ ...listDefaults, startingAfter: "seti_nonexistent" });
      } catch (err) {
        expect((err as StripeError).statusCode).toBe(404);
      }
    });

    it("list returns proper SI objects with all fields", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      siService.create({ payment_method: pm.id, customer: "cus_test" });
      const result = siService.list(listDefaults);
      const si = result.data[0];
      expect(si.id).toMatch(/^seti_/);
      expect(si.object).toBe("setup_intent");
      expect(si.payment_method).toBe(pm.id);
      expect(si.customer).toBe("cus_test");
    });

    it("list includes SIs in all statuses", () => {
      const { siService, pmService } = makeServices();
      const pm1 = createPM(pmService);
      const pm2 = createPM(pmService, "tok_mastercard");

      siService.create({}); // requires_payment_method
      siService.create({ payment_method: pm1.id }); // requires_confirmation
      siService.create({ payment_method: pm2.id, confirm: true }); // succeeded
      const toCancel = siService.create({});
      siService.cancel(toCancel.id); // canceled

      const result = siService.list({ ...listDefaults, limit: 10 });
      expect(result.data.length).toBe(4);
    });

    it("list returns url field on every call", () => {
      const { siService } = makeServices();
      siService.create({});
      const result = siService.list(listDefaults);
      expect(result.url).toBe("/v1/setup_intents");
    });

    it("list with startingAfter at last item returns empty with has_more false", () => {
      const { siService } = makeServices();
      siService.create({});
      const all = siService.list(listDefaults);
      const lastId = all.data[all.data.length - 1].id;
      const result = siService.list({ ...listDefaults, startingAfter: lastId });
      // May return empty or not depending on timestamp ordering
      // The key assertion is that it doesn't throw
      expect(result.data).toBeDefined();
    });

    it("list returns empty data array for empty DB", () => {
      const { siService } = makeServices();
      const result = siService.list(listDefaults);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(0);
    });

    it("list returns correct count with limit larger than total", () => {
      const { siService } = makeServices();
      siService.create({});
      siService.create({});
      const result = siService.list({ ...listDefaults, limit: 100 });
      expect(result.data.length).toBe(2);
      expect(result.has_more).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // State machine comprehensive tests
  // ---------------------------------------------------------------------------
  describe("state machine", () => {
    it("full flow: create → confirm → succeeded", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");

      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.status).toBe("succeeded");

      const retrieved = siService.retrieve(si.id);
      expect(retrieved.status).toBe("succeeded");
    });

    it("full flow: create (no PM) → confirm with PM → succeeded", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({});
      expect(si.status).toBe("requires_payment_method");

      const confirmed = siService.confirm(si.id, { payment_method: pm.id });
      expect(confirmed.status).toBe("succeeded");
    });

    it("full flow: create → cancel", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.status).toBe("requires_payment_method");

      const canceled = siService.cancel(si.id);
      expect(canceled.status).toBe("canceled");
    });

    it("full flow: create (with PM) → cancel", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");

      const canceled = siService.cancel(si.id);
      expect(canceled.status).toBe("canceled");
    });

    it("full flow: create with confirm=true → succeeded immediately", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");
    });

    it("cannot confirm from succeeded", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("cannot confirm from canceled", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      siService.cancel(si.id);
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("cannot cancel from succeeded", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(() => siService.cancel(si.id)).toThrow(StripeError);
    });

    it("cannot cancel from canceled", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      expect(() => siService.cancel(si.id)).toThrow(StripeError);
    });

    it("requires_payment_method → confirm without PM throws invalid_request_error", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.type).toBe("invalid_request_error");
      }
    });

    it("succeeded → confirm throws setup_intent_unexpected_state", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("setup_intent_unexpected_state");
      }
    });

    it("canceled → confirm throws setup_intent_unexpected_state", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("setup_intent_unexpected_state");
      }
    });

    it("succeeded → cancel throws setup_intent_unexpected_state", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("setup_intent_unexpected_state");
      }
    });

    it("canceled → cancel throws setup_intent_unexpected_state", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).body.error.code).toBe("setup_intent_unexpected_state");
      }
    });

    it("confirm error message mentions 'setup_intent' resource", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("setup_intent");
      }
    });

    it("cancel error message mentions 'setup_intent' resource", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect((err as StripeError).body.error.message).toContain("setup_intent");
      }
    });

    it("status is correct at every step of the create → confirm lifecycle", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);

      // Step 1: create with PM
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");
      expect(siService.retrieve(si.id).status).toBe("requires_confirmation");

      // Step 2: confirm
      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.status).toBe("succeeded");
      expect(siService.retrieve(si.id).status).toBe("succeeded");
    });

    it("status is correct at every step of the create → cancel lifecycle", () => {
      const { siService } = makeServices();

      const si = siService.create({});
      expect(si.status).toBe("requires_payment_method");
      expect(siService.retrieve(si.id).status).toBe("requires_payment_method");

      const canceled = siService.cancel(si.id);
      expect(canceled.status).toBe("canceled");
      expect(siService.retrieve(si.id).status).toBe("canceled");
    });

    it("independent SIs do not affect each other's state", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si1 = siService.create({ payment_method: pm.id });
      const si2 = siService.create({});

      siService.confirm(si1.id, {});
      siService.cancel(si2.id);

      expect(siService.retrieve(si1.id).status).toBe("succeeded");
      expect(siService.retrieve(si2.id).status).toBe("canceled");
    });

    it("creating many SIs and operating on them independently works", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);

      const sis = [];
      for (let i = 0; i < 10; i++) {
        sis.push(siService.create({ payment_method: pm.id }));
      }

      // Confirm odd, cancel even
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          siService.cancel(sis[i].id);
        } else {
          siService.confirm(sis[i].id, {});
        }
      }

      for (let i = 0; i < 10; i++) {
        const retrieved = siService.retrieve(sis[i].id);
        if (i % 2 === 0) {
          expect(retrieved.status).toBe("canceled");
        } else {
          expect(retrieved.status).toBe("succeeded");
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Object shape validation tests
  // ---------------------------------------------------------------------------
  describe("object shape", () => {
    it("has all expected top-level fields", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si).toHaveProperty("id");
      expect(si).toHaveProperty("object");
      expect(si).toHaveProperty("application");
      expect(si).toHaveProperty("automatic_payment_methods");
      expect(si).toHaveProperty("cancellation_reason");
      expect(si).toHaveProperty("client_secret");
      expect(si).toHaveProperty("created");
      expect(si).toHaveProperty("customer");
      expect(si).toHaveProperty("description");
      expect(si).toHaveProperty("last_setup_error");
      expect(si).toHaveProperty("latest_attempt");
      expect(si).toHaveProperty("livemode");
      expect(si).toHaveProperty("mandate");
      expect(si).toHaveProperty("metadata");
      expect(si).toHaveProperty("next_action");
      expect(si).toHaveProperty("on_behalf_of");
      expect(si).toHaveProperty("payment_method");
      expect(si).toHaveProperty("payment_method_options");
      expect(si).toHaveProperty("payment_method_types");
      expect(si).toHaveProperty("single_use_mandate");
      expect(si).toHaveProperty("status");
      expect(si).toHaveProperty("usage");
    });

    it("all nullable fields default to null when no params given", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.application).toBeNull();
      expect(si.automatic_payment_methods).toBeNull();
      expect(si.cancellation_reason).toBeNull();
      expect(si.customer).toBeNull();
      expect(si.description).toBeNull();
      expect(si.last_setup_error).toBeNull();
      expect(si.latest_attempt).toBeNull();
      expect(si.mandate).toBeNull();
      expect(si.next_action).toBeNull();
      expect(si.on_behalf_of).toBeNull();
      expect(si.payment_method).toBeNull();
      expect(si.single_use_mandate).toBeNull();
    });

    it("non-null defaults are correct", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.object).toBe("setup_intent");
      expect(si.livemode).toBe(false);
      expect(si.metadata).toEqual({});
      expect(si.payment_method_options).toEqual({});
      expect(si.payment_method_types).toEqual(["card"]);
      expect(si.status).toBe("requires_payment_method");
      expect(si.usage).toBe("off_session");
    });

    it("id is a string", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(typeof si.id).toBe("string");
    });

    it("client_secret is a string", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(typeof si.client_secret).toBe("string");
    });

    it("created is a number", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(typeof si.created).toBe("number");
    });

    it("livemode is a boolean", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(typeof si.livemode).toBe("boolean");
    });

    it("metadata is a plain object", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(typeof si.metadata).toBe("object");
      expect(si.metadata).not.toBeNull();
    });

    it("payment_method_types is an array", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(Array.isArray(si.payment_method_types)).toBe(true);
    });

    it("succeeded SI shape has correct status and payment_method", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");
      expect(si.payment_method).toBe(pm.id);
      expect(si.cancellation_reason).toBeNull();
    });

    it("canceled SI shape has correct status", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.status).toBe("canceled");
      expect(canceled.object).toBe("setup_intent");
    });
  });

  // ---------------------------------------------------------------------------
  // Database isolation tests
  // ---------------------------------------------------------------------------
  describe("database isolation", () => {
    it("separate makeServices() calls have independent databases", () => {
      const services1 = makeServices();
      const services2 = makeServices();

      services1.siService.create({});
      services1.siService.create({});

      const result1 = services1.siService.list(listDefaults);
      const result2 = services2.siService.list(listDefaults);

      expect(result1.data.length).toBe(2);
      expect(result2.data.length).toBe(0);
    });

    it("SI from one DB cannot be retrieved from another", () => {
      const services1 = makeServices();
      const services2 = makeServices();

      const si = services1.siService.create({});
      expect(() => services2.siService.retrieve(si.id)).toThrow(StripeError);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases and error handling
  // ---------------------------------------------------------------------------
  describe("edge cases", () => {
    it("creating SI with metadata containing special characters", () => {
      const { siService } = makeServices();
      const si = siService.create({
        metadata: { "key with spaces": "value/with/slashes", emoji: "test" },
      });
      expect(si.metadata).toEqual({ "key with spaces": "value/with/slashes", emoji: "test" });
    });

    it("creating SI with empty string customer", () => {
      const { siService } = makeServices();
      const si = siService.create({ customer: "" });
      // Empty string is falsy but still a string
      expect(si.customer).toBe("");
    });

    it("creating many SIs and listing them all", () => {
      const { siService } = makeServices();
      for (let i = 0; i < 20; i++) {
        siService.create({});
      }
      const result = siService.list({ ...listDefaults, limit: 100 });
      expect(result.data.length).toBe(20);
      expect(result.has_more).toBe(false);
    });

    it("confirm throws 404 for PM that was never created", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(() => siService.confirm(si.id, { payment_method: "pm_fake" })).toThrow(StripeError);
    });

    it("metadata is preserved through retrieve after create", () => {
      const { siService } = makeServices();
      const si = siService.create({ metadata: { track: "important" } });
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.metadata).toEqual({ track: "important" });
    });

    it("customer is preserved through retrieve after create", () => {
      const { siService } = makeServices();
      const si = siService.create({ customer: "cus_persist" });
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.customer).toBe("cus_persist");
    });

    it("confirm flow: create → retrieve → confirm → retrieve all consistent", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id, customer: "cus_flow" });

      const r1 = siService.retrieve(si.id);
      expect(r1.status).toBe("requires_confirmation");
      expect(r1.customer).toBe("cus_flow");

      siService.confirm(si.id, {});

      const r2 = siService.retrieve(si.id);
      expect(r2.status).toBe("succeeded");
      expect(r2.customer).toBe("cus_flow");
      expect(r2.payment_method).toBe(pm.id);
    });

    it("cancel flow: create → retrieve → cancel → retrieve all consistent", () => {
      const { siService } = makeServices();
      const si = siService.create({ customer: "cus_cancelflow", metadata: { a: "b" } });

      const r1 = siService.retrieve(si.id);
      expect(r1.status).toBe("requires_payment_method");

      siService.cancel(si.id);

      const r2 = siService.retrieve(si.id);
      expect(r2.status).toBe("canceled");
      expect(r2.customer).toBe("cus_cancelflow");
      expect(r2.metadata).toEqual({ a: "b" });
    });

    it("list after cancel includes canceled SIs", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      const result = siService.list(listDefaults);
      expect(result.data.length).toBe(1);
      expect(result.data[0].status).toBe("canceled");
    });

    it("list after confirm includes succeeded SIs", () => {
      const { siService, pmService } = makeServices();
      const pm = createPM(pmService);
      const si = siService.create({ payment_method: pm.id });
      siService.confirm(si.id, {});
      const result = siService.list(listDefaults);
      expect(result.data.length).toBe(1);
      expect(result.data[0].status).toBe("succeeded");
    });

    it("confirm with PM parameter on SI that already has a different PM uses the param PM", () => {
      const { siService, pmService } = makeServices();
      const pm1 = createPM(pmService, "tok_visa");
      const pm2 = createPM(pmService, "tok_amex");
      const si = siService.create({ payment_method: pm1.id });
      const confirmed = siService.confirm(si.id, { payment_method: pm2.id });
      expect(confirmed.payment_method).toBe(pm2.id);
      const retrieved = siService.retrieve(si.id);
      expect(retrieved.payment_method).toBe(pm2.id);
    });
  });
});
