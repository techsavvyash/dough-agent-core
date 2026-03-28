import { describe, test, expect } from "bun:test";
import { PlatformRuntime } from "../runtime.ts";
import { createDiffCheckpointExtension } from "./diff-checkpoint.ts";
import { createToolCallEvent } from "../events.ts";

describe("diff-checkpoint extension", () => {
  async function setupRuntime() {
    const runtime = new PlatformRuntime({ cwd: "/tmp/test" });
    const ext = createDiffCheckpointExtension();
    runtime.registerExtension(ext);
    await runtime.initialize();
    return { runtime, ext };
  }

  test("registers diff command, shortcut, and panel", async () => {
    const { runtime } = await setupRuntime();

    const commands = runtime.getCommands();
    expect(commands.find((c) => c.id === "diff.show")).toBeDefined();

    const shortcuts = runtime.getShortcuts();
    expect(shortcuts.find((s) => s.key === "ctrl+d")).toBeDefined();

    const panels = runtime.getPanels();
    expect(panels.find((p) => p.id === "diff.panel")).toBeDefined();
  });

  test("exposes FileTracker via getTracker()", async () => {
    const { ext } = await setupRuntime();
    expect(ext.getTracker()).toBeDefined();
  });

  test("getStats returns empty stats initially", async () => {
    const { ext } = await setupRuntime();
    const stats = ext.getStats();
    expect(stats.filesChanged).toBe(0);
    expect(stats.totalAdded).toBe(0);
    expect(stats.totalRemoved).toBe(0);
  });

  test("intercepts Write tool call events", async () => {
    const { runtime } = await setupRuntime();

    // This should trigger snapshotBefore internally (no error = success)
    const event = createToolCallEvent("c1", "Write", {
      file_path: "/tmp/nonexistent-test-file-" + Date.now() + ".ts",
      content: "hello",
    });
    await runtime.emit(event);

    // The event should not be vetoed or rewritten
    expect(event.vetoed).toBe(false);
    expect(event.rewritten).toBe(false);
  });

  test("intercepts Edit tool call events", async () => {
    const { runtime } = await setupRuntime();

    const event = createToolCallEvent("c2", "Edit", {
      path: "/tmp/nonexistent-test-file-" + Date.now() + ".ts",
      old_string: "foo",
      new_string: "bar",
    });
    await runtime.emit(event);

    expect(event.vetoed).toBe(false);
  });

  test("intercepts Delete tool call events", async () => {
    const { runtime } = await setupRuntime();

    const event = createToolCallEvent("c3", "Delete", {
      path: "/tmp/nonexistent-test-file-" + Date.now() + ".ts",
    });
    await runtime.emit(event);

    expect(event.vetoed).toBe(false);
  });

  test("does not intercept non-file-write tools", async () => {
    const { runtime, ext } = await setupRuntime();

    const event = createToolCallEvent("c4", "Bash", {
      command: "echo hello",
    });
    await runtime.emit(event);

    // Stats should still be empty
    expect(ext.getStats().filesChanged).toBe(0);
  });
});
