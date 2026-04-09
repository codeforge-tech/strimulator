import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { PaymentMethodService } from "../../../src/services/payment-methods";
import { SetupIntentService } from "../../../src/services/setup-intents";
import { StripeError } from "../../../src/errors";

function makeServices() {
  const db = createDB(":memory:");
  const pmService = new PaymentMethodService(db);
  const siService = new SetupIntentService(db, pmService);
  return { db, pmService, siService };
}

describe("SetupIntentService", () => {
  describe("create", () => {
    it("creates a setup intent with correct shape", () => {
      const { siService } = makeServices();
      const si = siService.create({});

      expect(si.id).toMatch(/^seti_/);
      expect(si.object).toBe("setup_intent");
      expect(si.livemode).toBe(false);
      expect(si.usage).toBe("off_session");
      expect(si.payment_method_types).toEqual(["card"]);
    });

    it("sets status to requires_payment_method when no PM given", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.status).toBe("requires_payment_method");
      expect(si.payment_method).toBeNull();
    });

    it("sets status to requires_confirmation when PM is given without confirm", () => {
      const { siService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");
      expect(si.payment_method).toBe(pm.id);
    });

    it("generates a client_secret with seti_ prefix", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(si.client_secret).toMatch(/^seti_/);
      expect(si.client_secret).toContain(si.id);
    });

    it("sets customer when provided", () => {
      const { siService } = makeServices();
      const si = siService.create({ customer: "cus_abc" });
      expect(si.customer).toBe("cus_abc");
    });

    it("stores metadata", () => {
      const { siService } = makeServices();
      const si = siService.create({ metadata: { order: "123" } });
      expect(si.metadata).toEqual({ order: "123" });
    });

    it("creates SI with PM + confirm=true and results in succeeded", () => {
      const { siService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");
      expect(si.payment_method).toBe(pm.id);
    });
  });

  describe("retrieve", () => {
    it("returns a setup intent by ID", () => {
      const { siService } = makeServices();
      const created = siService.create({});
      const retrieved = siService.retrieve(created.id);
      expect(retrieved.id).toBe(created.id);
    });

    it("throws 404 for nonexistent ID", () => {
      const { siService } = makeServices();
      expect(() => siService.retrieve("seti_nonexistent")).toThrow(StripeError);
      try {
        siService.retrieve("seti_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });

  describe("confirm", () => {
    it("confirms a SI from requires_confirmation and succeeds", () => {
      const { siService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const si = siService.create({ payment_method: pm.id });
      expect(si.status).toBe("requires_confirmation");

      const confirmed = siService.confirm(si.id, {});
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.payment_method).toBe(pm.id);
    });

    it("confirms from requires_payment_method with PM provided", () => {
      const { siService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const si = siService.create({});
      expect(si.status).toBe("requires_payment_method");

      const confirmed = siService.confirm(si.id, { payment_method: pm.id });
      expect(confirmed.status).toBe("succeeded");
      expect(confirmed.payment_method).toBe(pm.id);
    });

    it("confirm from wrong state throws error", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
      try {
        siService.confirm(si.id, {});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("confirm from succeeded state throws error", () => {
      const { siService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");

      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("requires payment_method when in requires_payment_method state without PM", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      expect(() => siService.confirm(si.id, {})).toThrow(StripeError);
    });

    it("throws 404 for nonexistent SI", () => {
      const { siService } = makeServices();
      expect(() => siService.confirm("seti_ghost", {})).toThrow(StripeError);
      try {
        siService.confirm("seti_ghost", {});
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });

  describe("cancel", () => {
    it("cancels a requires_payment_method SI", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      const canceled = siService.cancel(si.id);
      expect(canceled.status).toBe("canceled");
    });

    it("cancels a requires_confirmation SI", () => {
      const { siService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const si = siService.create({ payment_method: pm.id });
      const canceled = siService.cancel(si.id);
      expect(canceled.status).toBe("canceled");
    });

    it("cannot cancel a succeeded SI", () => {
      const { siService, pmService } = makeServices();
      const pm = pmService.create({ type: "card", card: { token: "tok_visa" } });
      const si = siService.create({ payment_method: pm.id, confirm: true });
      expect(si.status).toBe("succeeded");

      expect(() => siService.cancel(si.id)).toThrow(StripeError);
      try {
        siService.cancel(si.id);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("cannot cancel an already canceled SI", () => {
      const { siService } = makeServices();
      const si = siService.create({});
      siService.cancel(si.id);
      expect(() => siService.cancel(si.id)).toThrow(StripeError);
    });

    it("throws 404 for nonexistent SI", () => {
      const { siService } = makeServices();
      expect(() => siService.cancel("seti_ghost")).toThrow(StripeError);
      try {
        siService.cancel("seti_ghost");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
      }
    });
  });

  describe("list", () => {
    it("returns empty list when no setup intents exist", () => {
      const { siService } = makeServices();
      const result = siService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/setup_intents");
    });

    it("returns all setup intents up to limit", () => {
      const { siService } = makeServices();
      siService.create({});
      siService.create({});
      siService.create({});

      const result = siService.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(false);
    });

    it("respects limit with has_more", () => {
      const { siService } = makeServices();
      for (let i = 0; i < 5; i++) {
        siService.create({});
      }

      const result = siService.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });

    it("paginates with startingAfter", () => {
      const { siService } = makeServices();
      siService.create({});
      siService.create({});
      siService.create({});

      const page1 = siService.list({ limit: 2, startingAfter: undefined, endingBefore: undefined });
      expect(page1.data.length).toBe(2);

      const lastId = page1.data[page1.data.length - 1].id;
      const page2 = siService.list({ limit: 2, startingAfter: lastId, endingBefore: undefined });
      expect(page2.has_more).toBe(false);
    });
  });
});
