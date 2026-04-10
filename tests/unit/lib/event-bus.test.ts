import { describe, it, expect, beforeEach } from "bun:test";
import { EventBus, globalBus } from "../../../src/lib/event-bus";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("can be constructed", () => {
    expect(bus).toBeDefined();
    expect(bus).toBeInstanceOf(EventBus);
  });

  it("emit with no listeners does not throw", () => {
    expect(() => bus.emit("test", { data: 1 })).not.toThrow();
  });

  it("on registers a listener that receives events", () => {
    const received: any[] = [];
    bus.on("test", (event) => received.push(event));
    bus.emit("test", { value: 42 });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ value: 42 });
  });

  it("listener receives the exact event data", () => {
    let capturedEvent: any;
    bus.on("channel", (event) => {
      capturedEvent = event;
    });
    const payload = { type: "test", nested: { a: 1 } };
    bus.emit("channel", payload);
    expect(capturedEvent).toEqual(payload);
  });

  it("multiple listeners on the same channel all fire", () => {
    const results: number[] = [];
    bus.on("ch", () => results.push(1));
    bus.on("ch", () => results.push(2));
    bus.on("ch", () => results.push(3));
    bus.emit("ch", {});
    expect(results).toEqual([1, 2, 3]);
  });

  it("different channels do not cross-talk", () => {
    const channelA: any[] = [];
    const channelB: any[] = [];
    bus.on("a", (e) => channelA.push(e));
    bus.on("b", (e) => channelB.push(e));
    bus.emit("a", "hello");
    expect(channelA).toHaveLength(1);
    expect(channelB).toHaveLength(0);
  });

  it("emit to channel B does not trigger channel A listeners", () => {
    let aCalled = false;
    bus.on("a", () => {
      aCalled = true;
    });
    bus.emit("b", {});
    expect(aCalled).toBe(false);
  });

  it("on returns an unsubscribe function", () => {
    const unsub = bus.on("test", () => {});
    expect(typeof unsub).toBe("function");
  });

  it("unsubscribe removes the listener", () => {
    const received: any[] = [];
    const unsub = bus.on("test", (e) => received.push(e));
    bus.emit("test", "first");
    expect(received).toHaveLength(1);

    unsub();
    bus.emit("test", "second");
    expect(received).toHaveLength(1); // no second event received
  });

  it("unsubscribe only removes the specific listener", () => {
    const results: string[] = [];
    const unsub = bus.on("ch", () => results.push("a"));
    bus.on("ch", () => results.push("b"));

    unsub();
    bus.emit("ch", {});
    expect(results).toEqual(["b"]);
  });

  it("listener can be added and events emitted multiple times", () => {
    const received: number[] = [];
    bus.on("count", (n) => received.push(n));
    bus.emit("count", 1);
    bus.emit("count", 2);
    bus.emit("count", 3);
    expect(received).toEqual([1, 2, 3]);
  });

  it("emitting to nonexistent channel does not throw", () => {
    expect(() => bus.emit("nonexistent", "data")).not.toThrow();
  });

  it("listeners receive different data types", () => {
    const received: any[] = [];
    bus.on("any", (e) => received.push(e));
    bus.emit("any", "string");
    bus.emit("any", 42);
    bus.emit("any", null);
    bus.emit("any", { key: "value" });
    expect(received).toEqual(["string", 42, null, { key: "value" }]);
  });

  it("multiple unsubscribes are idempotent", () => {
    const received: any[] = [];
    const unsub = bus.on("test", (e) => received.push(e));
    unsub();
    unsub(); // calling again should not throw
    bus.emit("test", "data");
    expect(received).toHaveLength(0);
  });

  it("supports many channels simultaneously", () => {
    const results = new Map<string, any[]>();
    for (const ch of ["a", "b", "c", "d", "e"]) {
      results.set(ch, []);
      bus.on(ch, (e) => results.get(ch)!.push(e));
    }
    bus.emit("c", "hello");
    expect(results.get("c")).toEqual(["hello"]);
    expect(results.get("a")).toEqual([]);
    expect(results.get("b")).toEqual([]);
  });
});

describe("globalBus", () => {
  it("exists and is an EventBus instance", () => {
    expect(globalBus).toBeDefined();
    expect(globalBus).toBeInstanceOf(EventBus);
  });

  it("can register and emit events", () => {
    const received: any[] = [];
    const unsub = globalBus.on("global-test-channel", (e) => received.push(e));
    globalBus.emit("global-test-channel", { test: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ test: true });
    unsub(); // cleanup
  });

  it("is a singleton (same reference across imports)", async () => {
    // Re-import to verify same instance
    const { globalBus: bus2 } = await import("../../../src/lib/event-bus");
    expect(globalBus).toBe(bus2);
  });
});
