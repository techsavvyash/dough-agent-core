import { describe, test, expect } from "bun:test";
import { PlatformRuntime } from "../runtime.ts";
import { createSessionCommandsExtension } from "./session-commands.ts";

describe("session-commands extension", () => {
  async function setupRuntime() {
    const runtime = new PlatformRuntime({ cwd: "/tmp/test" });
    runtime.registerExtension(createSessionCommandsExtension());
    await runtime.initialize();
    return runtime;
  }

  test("registers all expected commands", async () => {
    const runtime = await setupRuntime();
    const commands = runtime.getCommands();
    const ids = commands.map((c) => c.id);

    expect(ids).toContain("session.thread_info");
    expect(ids).toContain("session.thread_list");
    expect(ids).toContain("session.thread_fork");
    expect(ids).toContain("session.thread_new");
    expect(ids).toContain("session.clear");
    expect(ids).toContain("session.compact");
    expect(ids).toContain("session.exit");
    expect(ids).toContain("session.bash_output");
  });

  test("registers ctrl+t and ctrl+o shortcuts", async () => {
    const runtime = await setupRuntime();
    const shortcuts = runtime.getShortcuts();

    const ctrlT = shortcuts.find((s) => s.key === "ctrl+t");
    expect(ctrlT).toBeDefined();
    expect(ctrlT!.commandId).toBe("session.thread_list");

    const ctrlO = shortcuts.find((s) => s.key === "ctrl+o");
    expect(ctrlO).toBeDefined();
    expect(ctrlO!.commandId).toBe("session.bash_output");
  });

  test("registers thread and bash panels", async () => {
    const runtime = await setupRuntime();
    const panels = runtime.getPanels();

    expect(panels.find((p) => p.id === "threads.panel")).toBeDefined();
    expect(panels.find((p) => p.id === "bash.panel")).toBeDefined();
  });

  test("thread_info command emits notification", async () => {
    const runtime = await setupRuntime();
    runtime.setSession("s1", "t1");

    const cmd = runtime.getCommand("session.thread_info");
    expect(cmd).toBeDefined();

    await cmd!.execute({
      sessionId: "s1",
      activeThreadId: "t1",
      runtime,
    });

    const notifications = runtime.drainNotifications();
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].message).toContain("Thread: t1");
    expect(notifications[0].message).toContain("Session: s1");
  });

  test("thread_list command opens threads panel", async () => {
    const runtime = await setupRuntime();

    const cmd = runtime.getCommand("session.thread_list");
    await cmd!.execute({
      sessionId: "s1",
      activeThreadId: "t1",
      runtime,
    });

    const intents = runtime.drainPanelOpenIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0].panelId).toBe("threads.panel");
  });

  test("bash_output command opens bash panel", async () => {
    const runtime = await setupRuntime();

    const cmd = runtime.getCommand("session.bash_output");
    await cmd!.execute({
      sessionId: "s1",
      activeThreadId: "t1",
      runtime,
    });

    const intents = runtime.drainPanelOpenIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0].panelId).toBe("bash.panel");
  });

  test("thread_fork warns when no active thread", async () => {
    const runtime = await setupRuntime();
    // sessionId set but no active thread via API
    const cmd = runtime.getCommand("session.thread_fork");
    await cmd!.execute({
      sessionId: "s1",
      activeThreadId: "",
      runtime,
    });

    // The command checks api.activeThreadId which is null since runtime
    // setSession was never called — so it should notify warning
    const notifications = runtime.drainNotifications();
    expect(notifications.length).toBeGreaterThan(0);
  });

  test("commands have correct categories", async () => {
    const runtime = await setupRuntime();
    const commands = runtime.getCommands();

    const threadCmds = commands.filter((c) => c.category === "thread");
    expect(threadCmds.length).toBeGreaterThanOrEqual(4);

    const sessionCmds = commands.filter((c) => c.category === "session");
    expect(sessionCmds.length).toBeGreaterThanOrEqual(3);
  });
});
