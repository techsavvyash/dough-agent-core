import { describe, test, expect, mock } from "bun:test";
import { PlatformRuntime } from "./runtime.ts";
import type { RuntimeExtension } from "./extension.ts";
import type { PlatformAPI } from "./api.ts";
import type { RuntimeCommand } from "./types.ts";

function createTestExtension(
  id: string,
  setupFn?: (api: PlatformAPI) => void | Promise<void>,
): RuntimeExtension {
  return {
    id,
    name: id,
    kind: "both",
    setup: setupFn ?? (() => {}),
  };
}

describe("PlatformRuntime", () => {
  test("can be constructed with defaults", () => {
    const runtime = new PlatformRuntime();
    expect(runtime.cwd).toBeTruthy();
    expect(runtime.getSessionId()).toBeNull();
    expect(runtime.getActiveThreadId()).toBeNull();
  });

  test("can be constructed with custom cwd", () => {
    const runtime = new PlatformRuntime({ cwd: "/tmp/test" });
    expect(runtime.cwd).toBe("/tmp/test");
  });

  test("registerExtension and initialize calls setup", async () => {
    const runtime = new PlatformRuntime();
    const setupFn = mock(() => {});
    const ext = createTestExtension("test-ext", setupFn);

    runtime.registerExtension(ext);
    await runtime.initialize();

    expect(setupFn).toHaveBeenCalledTimes(1);
  });

  test("registerExtension rejects duplicate ids", () => {
    const runtime = new PlatformRuntime();
    runtime.registerExtension(createTestExtension("ext-a"));

    expect(() => runtime.registerExtension(createTestExtension("ext-a"))).toThrow(
      'Extension "ext-a" is already registered',
    );
  });

  test("initialize is idempotent", async () => {
    const runtime = new PlatformRuntime();
    const setupFn = mock(() => {});
    runtime.registerExtension(createTestExtension("ext", setupFn));

    await runtime.initialize();
    await runtime.initialize();

    expect(setupFn).toHaveBeenCalledTimes(1);
  });

  test("extension receives PlatformAPI with event subscription", async () => {
    const runtime = new PlatformRuntime();
    const handler = mock(() => {});

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.on("turn:start", handler);
      }),
    );
    await runtime.initialize();

    await runtime.emit({ type: "turn:start", sessionId: "s1", threadId: "t1" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("extension can register commands", async () => {
    const runtime = new PlatformRuntime();
    const cmd: RuntimeCommand = {
      id: "test.hello",
      name: "/hello",
      description: "Say hello",
      execute: () => {},
    };

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.registerCommand(cmd);
      }),
    );
    await runtime.initialize();

    const commands = runtime.getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].id).toBe("test.hello");
    expect(runtime.getCommand("test.hello")).toBe(cmd);
  });

  test("extension can register shortcuts", async () => {
    const runtime = new PlatformRuntime();

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.registerShortcut({
          id: "diff.open",
          key: "ctrl+d",
          description: "Open diff view",
          commandId: "diff.show",
        });
      }),
    );
    await runtime.initialize();

    const shortcuts = runtime.getShortcuts();
    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0].key).toBe("ctrl+d");
  });

  test("extension can register panels", async () => {
    const runtime = new PlatformRuntime();

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.registerPanel({
          id: "diff.panel",
          name: "File Changes",
          mode: "overlay",
        });
      }),
    );
    await runtime.initialize();

    const panels = runtime.getPanels();
    expect(panels).toHaveLength(1);
    expect(panels[0].mode).toBe("overlay");
  });

  test("extension can register tools", async () => {
    const runtime = new PlatformRuntime();

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.registerTool({
          name: "echo",
          description: "Echo input",
          parameters: {},
          execute: async (args) => args,
        });
      }),
    );
    await runtime.initialize();

    const tools = runtime.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("echo");
  });

  test("notify queues notifications and drainNotifications clears them", async () => {
    const runtime = new PlatformRuntime();

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.notify("hello", "info");
        api.notify("oops", "error");
      }),
    );
    await runtime.initialize();

    const notifications = runtime.drainNotifications();
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toEqual({ message: "hello", level: "info" });
    expect(notifications[1]).toEqual({ message: "oops", level: "error" });

    // Second drain should be empty
    expect(runtime.drainNotifications()).toHaveLength(0);
  });

  test("setStatus and getStatus work", async () => {
    const runtime = new PlatformRuntime();

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.setStatus("diff", "3 files changed");
        api.setStatus("git", "main");
      }),
    );
    await runtime.initialize();

    const status = runtime.getStatus();
    expect(status.get("diff")).toBe("3 files changed");
    expect(status.get("git")).toBe("main");
  });

  test("setStatus with undefined clears the entry", async () => {
    const runtime = new PlatformRuntime();

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.setStatus("key", "value");
        api.setStatus("key", undefined);
      }),
    );
    await runtime.initialize();

    expect(runtime.getStatus().has("key")).toBe(false);
  });

  test("openPanel queues intent and drainPanelOpenIntents clears it", async () => {
    const runtime = new PlatformRuntime();

    runtime.registerExtension(
      createTestExtension("ext", (api) => {
        api.openPanel("diff.panel", { files: ["a.ts"] });
      }),
    );
    await runtime.initialize();

    const intents = runtime.drainPanelOpenIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0].panelId).toBe("diff.panel");
    expect(runtime.drainPanelOpenIntents()).toHaveLength(0);
  });

  test("session state is scoped by extension id", async () => {
    const runtime = new PlatformRuntime();
    let apiA: PlatformAPI;
    let apiB: PlatformAPI;

    runtime.registerExtension({
      id: "ext-a",
      name: "A",
      kind: "both",
      setup(api) {
        apiA = api;
        api.setSessionState("data", { count: 1 });
      },
    });
    runtime.registerExtension({
      id: "ext-b",
      name: "B",
      kind: "both",
      setup(api) {
        apiB = api;
        api.setSessionState("data", { count: 99 });
      },
    });
    await runtime.initialize();

    expect(apiA!.getSessionState("data")).toEqual({ count: 1 });
    expect(apiB!.getSessionState("data")).toEqual({ count: 99 });
  });

  test("API reflects current session state", async () => {
    const runtime = new PlatformRuntime();
    let capturedApi: PlatformAPI;

    runtime.registerExtension({
      id: "ext",
      name: "ext",
      kind: "both",
      setup(api) {
        capturedApi = api;
      },
    });
    await runtime.initialize();

    expect(capturedApi!.sessionId).toBeNull();
    expect(capturedApi!.activeThreadId).toBeNull();

    runtime.setSession("s1", "t1");
    expect(capturedApi!.sessionId).toBe("s1");
    expect(capturedApi!.activeThreadId).toBe("t1");
  });

  test("client registration and retrieval", () => {
    const runtime = new PlatformRuntime();
    expect(runtime.getClient()).toBeNull();

    const mockClient = {
      id: "claude",
      name: "claude",
      maxContextTokens: 200_000,
      capabilities: { nativeMcp: true, nativeSessionRestore: true, nativeToolApproval: false },
      async *runTurn() {},
      estimateTokens: () => 0,
    } as any;

    runtime.registerClient(mockClient);
    expect(runtime.getClient()).toBe(mockClient);
  });

  test("dispose clears all state and allows re-initialization", async () => {
    const runtime = new PlatformRuntime();
    const setupFn = mock(() => {});

    runtime.registerExtension(createTestExtension("ext", (api) => {
      setupFn();
      api.registerCommand({
        id: "test",
        name: "/test",
        description: "test",
        execute: () => {},
      });
    }));
    await runtime.initialize();
    expect(runtime.getCommands()).toHaveLength(1);

    await runtime.dispose();
    expect(runtime.getCommands()).toHaveLength(0);

    // Can register and initialize again
    runtime.registerExtension(createTestExtension("ext2", () => {}));
    await runtime.initialize();
  });

  test("getExtension returns registered extension", async () => {
    const runtime = new PlatformRuntime();
    const ext = createTestExtension("my-ext");
    runtime.registerExtension(ext);
    await runtime.initialize();

    expect(runtime.getExtension("my-ext")).toBe(ext);
    expect(runtime.getExtension("nonexistent")).toBeUndefined();
  });

  test("multiple extensions receive events in registration order", async () => {
    const runtime = new PlatformRuntime();
    const order: string[] = [];

    runtime.registerExtension(
      createTestExtension("ext-a", (api) => {
        api.on("turn:start", () => {
          order.push("a");
        });
      }),
    );
    runtime.registerExtension(
      createTestExtension("ext-b", (api) => {
        api.on("turn:start", () => {
          order.push("b");
        });
      }),
    );
    await runtime.initialize();

    await runtime.emit({ type: "turn:start", sessionId: "s1", threadId: "t1" });
    expect(order).toEqual(["a", "b"]);
  });
});
