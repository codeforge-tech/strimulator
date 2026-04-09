import { describe, it, expect } from "bun:test";
import { createDB } from "../../../src/db";
import { TestClockService } from "../../../src/services/test-clocks";
import { StripeError } from "../../../src/errors";

function makeService() {
  const db = createDB(":memory:");
  return new TestClockService(db);
}

describe("TestClockService", () => {
  describe("create", () => {
    it("creates a test clock with correct shape", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: frozenTime, name: "My Clock" });

      expect(clock.id).toMatch(/^clock_/);
      expect(clock.object).toBe("test_helpers.test_clock");
      expect(clock.frozen_time).toBe(frozenTime);
      expect(clock.name).toBe("My Clock");
      expect(clock.livemode).toBe(false);
      expect(clock.status).toBe("ready");
      expect(typeof clock.created).toBe("number");
      expect(typeof clock.deletes_after).toBe("number");
    });

    it("creates a test clock without a name", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: frozenTime });

      expect(clock.name).toBeNull();
    });

    it("sets deletes_after to 30 days after creation", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const before = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: frozenTime });
      const after = Math.floor(Date.now() / 1000);

      const thirtyDays = 30 * 24 * 60 * 60;
      expect(clock.deletes_after).toBeGreaterThanOrEqual(before + thirtyDays);
      expect(clock.deletes_after).toBeLessThanOrEqual(after + thirtyDays);
    });
  });

  describe("retrieve", () => {
    it("returns a test clock by ID", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const created = svc.create({ frozen_time: frozenTime, name: "Test" });
      const retrieved = svc.retrieve(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.frozen_time).toBe(frozenTime);
    });

    it("throws 404 for nonexistent test clock", () => {
      const svc = makeService();
      expect(() => svc.retrieve("clock_nonexistent")).toThrow();
      try {
        svc.retrieve("clock_nonexistent");
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(404);
        expect((err as StripeError).body.error.code).toBe("resource_missing");
      }
    });
  });

  describe("advance", () => {
    it("advances the frozen time forward", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: frozenTime });

      const newFrozenTime = frozenTime + 3600; // 1 hour later
      const advanced = svc.advance(clock.id, newFrozenTime);

      expect(advanced.frozen_time).toBe(newFrozenTime);
    });

    it("persists the advanced time", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: frozenTime });

      const newFrozenTime = frozenTime + 7200;
      svc.advance(clock.id, newFrozenTime);

      const retrieved = svc.retrieve(clock.id);
      expect(retrieved.frozen_time).toBe(newFrozenTime);
    });

    it("throws when advancing backward (new time <= current time)", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000) + 10000;
      const clock = svc.create({ frozen_time: frozenTime });

      expect(() => svc.advance(clock.id, frozenTime - 100)).toThrow();
      try {
        svc.advance(clock.id, frozenTime - 100);
      } catch (err) {
        expect(err).toBeInstanceOf(StripeError);
        expect((err as StripeError).statusCode).toBe(400);
      }
    });

    it("throws when advancing to the same time", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: frozenTime });

      expect(() => svc.advance(clock.id, frozenTime)).toThrow();
    });

    it("throws 404 when advancing nonexistent clock", () => {
      const svc = makeService();
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      expect(() => svc.advance("clock_nonexistent", futureTime)).toThrow();
    });
  });

  describe("del", () => {
    it("deletes a test clock", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: frozenTime });

      const deleted = svc.del(clock.id);
      expect(deleted.id).toBe(clock.id);
      expect(deleted.object).toBe("test_helpers.test_clock");
      expect(deleted.deleted).toBe(true);
    });

    it("actually removes the record (retrieve throws after delete)", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      const clock = svc.create({ frozen_time: frozenTime });

      svc.del(clock.id);
      expect(() => svc.retrieve(clock.id)).toThrow();
    });

    it("throws 404 for nonexistent test clock", () => {
      const svc = makeService();
      expect(() => svc.del("clock_nonexistent")).toThrow();
    });
  });

  describe("list", () => {
    it("returns empty list when no test clocks exist", () => {
      const svc = makeService();
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });

      expect(result.object).toBe("list");
      expect(result.data).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.url).toBe("/v1/test_helpers/test_clocks");
    });

    it("returns all test clocks up to limit", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 5; i++) {
        svc.create({ frozen_time: frozenTime + i });
      }
      const result = svc.list({ limit: 10, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(5);
      expect(result.has_more).toBe(false);
    });

    it("respects limit", () => {
      const svc = makeService();
      const frozenTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 5; i++) {
        svc.create({ frozen_time: frozenTime + i });
      }
      const result = svc.list({ limit: 3, startingAfter: undefined, endingBefore: undefined });
      expect(result.data.length).toBe(3);
      expect(result.has_more).toBe(true);
    });
  });
});
