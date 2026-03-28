import { describe, test, expect, mock } from "bun:test";
import { EventBus } from "./event-bus.ts";
import { createToolCallEvent } from "./events.ts";
import type { TurnStartEvent } from "./events.ts";

describe("EventBus", () => {
  test("dispatches event to registered handler", async () => {
    const bus = new EventBus();
    const handler = mock(() => {});
    bus.on("turn:start", handler);

    const event: TurnStartEvent = {
      type: "turn:start",
      sessionId: "s1",
      threadId: "t1",
    };
    await bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  test("dispatches to multiple handlers sequentially", async () => {
    const bus = new EventBus();
    const order: number[] = [];

    bus.on("turn:start", async () => {
      order.push(1);
      // Simulate async work
      await new Promise((r) => setTimeout(r, 5));
      order.push(2);
    });

    bus.on("turn:start", () => {
      order.push(3);
    });

    await bus.emit<"turn:start">({
      type: "turn:start",
      sessionId: "s1",
      threadId: "t1",
    });

    // Handler 1 must fully complete before handler 2 starts
    expect(order).toEqual([1, 2, 3]);
  });

  test("unsubscribe removes handler", async () => {
    const bus = new EventBus();
    const handler = mock(() => {});
    const unsub = bus.on("turn:end", handler);

    unsub();

    await bus.emit<"turn:end">({
      type: "turn:end",
      sessionId: "s1",
      threadId: "t1",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  test("off() removes handler", async () => {
    const bus = new EventBus();
    const handler = mock(() => {});
    bus.on("turn:start", handler);
    bus.off("turn:start", handler);

    await bus.emit<"turn:start">({
      type: "turn:start",
      sessionId: "s1",
      threadId: "t1",
    });

    expect(handler).not.toHaveBeenCalled();
  });

  test("handler error does not prevent subsequent handlers", async () => {
    const bus = new EventBus();
    // Silence the default error log
    bus.onError(() => {});

    const handler1 = mock(() => {
      throw new Error("boom");
    });
    const handler2 = mock(() => {});

    bus.on("turn:start", handler1);
    bus.on("turn:start", handler2);

    await bus.emit<"turn:start">({
      type: "turn:start",
      sessionId: "s1",
      threadId: "t1",
    });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  test("error handler receives event type, error, and index", async () => {
    const bus = new EventBus();
    const errorHandler = mock(() => {});
    bus.onError(errorHandler);

    const err = new Error("test error");
    bus.on("turn:start", () => {
      throw err;
    });

    await bus.emit<"turn:start">({
      type: "turn:start",
      sessionId: "s1",
      threadId: "t1",
    });

    expect(errorHandler).toHaveBeenCalledWith("turn:start", err, 0);
  });

  test("no-op when no handlers registered", async () => {
    const bus = new EventBus();
    // Should not throw
    await bus.emit<"turn:start">({
      type: "turn:start",
      sessionId: "s1",
      threadId: "t1",
    });
  });

  test("hasHandlers returns correct state", () => {
    const bus = new EventBus();
    expect(bus.hasHandlers("turn:start")).toBe(false);

    const unsub = bus.on("turn:start", () => {});
    expect(bus.hasHandlers("turn:start")).toBe(true);

    unsub();
    expect(bus.hasHandlers("turn:start")).toBe(false);
  });

  test("clear() removes all handlers", async () => {
    const bus = new EventBus();
    const handler = mock(() => {});
    bus.on("turn:start", handler);
    bus.on("turn:end", handler);

    bus.clear();

    expect(bus.hasHandlers("turn:start")).toBe(false);
    expect(bus.hasHandlers("turn:end")).toBe(false);
  });

  test("tool:call event supports veto()", async () => {
    const bus = new EventBus();

    bus.on("tool:call", (event) => {
      if (event.toolName === "Bash") {
        event.veto();
      }
    });

    const event = createToolCallEvent("c1", "Bash", { command: "rm -rf /" });
    await bus.emit(event);

    expect(event.vetoed).toBe(true);
  });

  test("tool:call event supports rewrite()", async () => {
    const bus = new EventBus();

    bus.on("tool:call", (event) => {
      event.rewrite({ command: "echo safe" });
    });

    const event = createToolCallEvent("c1", "Bash", { command: "rm -rf /" });
    await bus.emit(event);

    expect(event.rewritten).toBe(true);
    expect(event.args).toEqual({ command: "echo safe" });
  });

  test("handler list snapshot prevents mutation during iteration", async () => {
    const bus = new EventBus();
    const calls: string[] = [];

    bus.on("turn:start", () => {
      calls.push("first");
      // Add a handler during iteration — should NOT run in this emit
      bus.on("turn:start", () => {
        calls.push("dynamic");
      });
    });

    bus.on("turn:start", () => {
      calls.push("second");
    });

    await bus.emit<"turn:start">({
      type: "turn:start",
      sessionId: "s1",
      threadId: "t1",
    });

    expect(calls).toEqual(["first", "second"]);
  });
});
