import { describe, test, expect } from "bun:test";
import { PlatformRuntime } from "../runtime.ts";
import { createGitPolicyExtension } from "./git-policy.ts";
import { createToolCallEvent } from "../events.ts";

describe("git-policy extension", () => {
  async function setupRuntime(config?: Parameters<typeof createGitPolicyExtension>[0]) {
    const runtime = new PlatformRuntime({ cwd: "/tmp/test" });
    runtime.registerExtension(createGitPolicyExtension(config));
    await runtime.initialize();
    return runtime;
  }

  test("rewrites git commit command to include --trailer", async () => {
    const runtime = await setupRuntime();

    const event = createToolCallEvent("c1", "Bash", {
      command: 'git commit -m "test"',
    });
    await runtime.emit(event);

    expect(event.rewritten).toBe(true);
    expect(event.args.command).toContain("--trailer");
    expect(event.args.command).toContain("Co-Authored-By: Dough Agent");
  });

  test("skips non-Bash tools", async () => {
    const runtime = await setupRuntime();

    const event = createToolCallEvent("c1", "Write", {
      path: "/tmp/test.ts",
      content: "hello",
    });
    await runtime.emit(event);

    expect(event.rewritten).toBe(false);
  });

  test("skips non-git-commit Bash commands", async () => {
    const runtime = await setupRuntime();

    const event = createToolCallEvent("c1", "Bash", {
      command: "ls -la",
    });
    await runtime.emit(event);

    expect(event.rewritten).toBe(false);
  });

  test("skips --amend commits", async () => {
    const runtime = await setupRuntime();

    const event = createToolCallEvent("c1", "Bash", {
      command: "git commit --amend --no-edit",
    });
    await runtime.emit(event);

    expect(event.rewritten).toBe(false);
  });

  test("skips commands that already have the trailer", async () => {
    const runtime = await setupRuntime();

    const event = createToolCallEvent("c1", "Bash", {
      command: 'git commit -m "test" --trailer "Co-Authored-By: Dough Agent <noreply@try-dough.com>"',
    });
    await runtime.emit(event);

    expect(event.rewritten).toBe(false);
  });

  test("uses custom trailer when configured", async () => {
    const custom = "Signed-off-by: Custom Bot <bot@example.com>";
    const runtime = await setupRuntime({ trailer: custom });

    const event = createToolCallEvent("c1", "Bash", {
      command: 'git commit -m "test"',
    });
    await runtime.emit(event);

    expect(event.rewritten).toBe(true);
    expect(event.args.command).toContain(custom);
  });

  test("registers attribution info command", async () => {
    const runtime = await setupRuntime();
    const commands = runtime.getCommands();
    const cmd = commands.find((c) => c.id === "git.attribution_info");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("/git attribution");
  });
});
