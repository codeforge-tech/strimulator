import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { actionFlags } from "../../../src/lib/action-flags";

describe("actionFlags", () => {
  beforeEach(() => {
    actionFlags.failNextPayment = null;
  });

  afterEach(() => {
    actionFlags.failNextPayment = null;
  });

  it("exists and is an object", () => {
    expect(actionFlags).toBeDefined();
    expect(typeof actionFlags).toBe("object");
  });

  it("has a failNextPayment property", () => {
    expect("failNextPayment" in actionFlags).toBe(true);
  });

  it("failNextPayment defaults to null", () => {
    expect(actionFlags.failNextPayment).toBeNull();
  });

  it("can set failNextPayment to an error code string", () => {
    actionFlags.failNextPayment = "card_declined";
    expect(actionFlags.failNextPayment).toBe("card_declined");
  });

  it("can set failNextPayment to a different error code", () => {
    actionFlags.failNextPayment = "insufficient_funds";
    expect(actionFlags.failNextPayment).toBe("insufficient_funds");
  });

  it("can read failNextPayment after setting", () => {
    actionFlags.failNextPayment = "expired_card";
    const value = actionFlags.failNextPayment;
    expect(value).toBe("expired_card");
  });

  it("can reset failNextPayment to null", () => {
    actionFlags.failNextPayment = "card_declined";
    expect(actionFlags.failNextPayment).toBe("card_declined");
    actionFlags.failNextPayment = null;
    expect(actionFlags.failNextPayment).toBeNull();
  });

  it("setting multiple times only keeps the last value", () => {
    actionFlags.failNextPayment = "card_declined";
    actionFlags.failNextPayment = "insufficient_funds";
    actionFlags.failNextPayment = "processing_error";
    expect(actionFlags.failNextPayment).toBe("processing_error");
  });

  it("is mutable (not frozen)", () => {
    expect(Object.isFrozen(actionFlags)).toBe(false);
  });

  it("is a shared reference (changes visible across reads)", () => {
    const ref = actionFlags;
    ref.failNextPayment = "test_code";
    expect(actionFlags.failNextPayment).toBe("test_code");
  });
});
