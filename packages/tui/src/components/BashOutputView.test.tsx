import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createSpy } from "@opentui/core/testing";
import { act } from "react";
import { BashOutputView } from "./BashOutputView.tsx";
import type { BashCallEntry } from "./BashOutputView.tsx";

function makeCall(overrides: Partial<BashCallEntry> = {}): BashCallEntry {
  return {
    callId: crypto.randomUUID(),
    command: "echo hello",
    output: "hello",
    status: "success",
    ...overrides,
  };
}

describe("BashOutputView", () => {
  test("shows empty message when no calls", async () => {
    const onClose = createSpy();
    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={[]} onClose={onClose} />,
      { width: 100, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("No bash commands");
  });

  test("shows header with command count", async () => {
    const calls = [
      makeCall({ command: "ls -la", output: "total 8\n drwxr-xr-x 2 user user 4096" }),
      makeCall({ command: "pwd", output: "/home/user" }),
    ];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Bash Output");
    expect(frame).toContain("2 commands");
  });

  test("selects last call by default", async () => {
    const calls = [
      makeCall({ callId: "first-call-id", command: "echo first", output: "first" }),
      makeCall({ callId: "last-call-id", command: "echo last", output: "last output here" }),
    ];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Last call's output should be displayed in the main panel
    expect(frame).toContain("last output here");
  });

  test("shows command in output panel header", async () => {
    const calls = [makeCall({ command: "git status", output: "On branch main" })];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("git status");
    expect(frame).toContain("On branch main");
  });

  test("shows pending status indicator", async () => {
    const calls = [makeCall({ command: "sleep 10", output: undefined, status: "pending" })];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("running");
  });

  test("shows (no output) when output is empty string", async () => {
    const calls = [makeCall({ command: "true", output: "", status: "success" })];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("no output");
  });

  test("escape closes the view", async () => {
    const onClose = createSpy();
    const calls = [makeCall()];

    const { mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={onClose} />,
      { width: 100, height: 20 }
    );
    await renderOnce();

    await act(async () => {
      mockInput.pressEscape();
      await new Promise(r => setTimeout(r, 500));
    });
    await renderOnce();

    expect(onClose.callCount()).toBe(1);
  });

  test("shows navigation hint", async () => {
    const calls = [makeCall()];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Esc");
    expect(frame).toContain("navigate");
  });

  // ── Sidebar list ──────────────────────────────────────────────────────────────

  test("sidebar lists all commands", async () => {
    const calls = [
      makeCall({ command: "ls -la" }),
      makeCall({ command: "git diff" }),
      makeCall({ command: "bun test" }),
    ];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("ls -la");
    expect(frame).toContain("git diff");
    expect(frame).toContain("bun test");
  });

  test("shows index indicator in sidebar footer", async () => {
    const calls = [makeCall(), makeCall(), makeCall()];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Defaults to last (3/3)
    expect(frame).toContain("3/3");
  });

  // ── Panel focus (l/h) ─────────────────────────────────────────────────────────

  test("starts with sidebar focused — hint says 'navigate'", async () => {
    const calls = [makeCall()];

    const { captureCharFrame, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    expect(captureCharFrame()).toContain("navigate");
  });

  test("l moves focus to output panel — hint updates to 'scroll output'", async () => {
    const calls = [makeCall({ output: "some output" })];

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    act(() => { mockInput.pressKey("l"); });
    await renderOnce();

    expect(captureCharFrame()).toContain("scroll output");
  });

  test("h moves focus back to sidebar — hint reverts to 'navigate'", async () => {
    const calls = [makeCall()];

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    act(() => { mockInput.pressKey("l"); });
    await renderOnce();
    act(() => { mockInput.pressKey("h"); });
    await renderOnce();

    expect(captureCharFrame()).toContain("navigate");
  });

  test("focusing output panel shows ● dot in command header", async () => {
    const calls = [makeCall()];

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    // No dot before focusing output panel
    expect(captureCharFrame()).not.toContain("●");

    act(() => { mockInput.pressKey("l"); });
    await renderOnce();

    expect(captureCharFrame()).toContain("●");
  });

  // ── Sidebar j/k navigation ───────────────────────────────────────────────────

  test("j navigates to previous command in sidebar (sidebar focused)", async () => {
    const calls = [
      makeCall({ callId: "first-00", command: "echo first", output: "first output" }),
      makeCall({ callId: "second-0", command: "echo second", output: "second output" }),
    ];

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    // Starts on last (second) call — navigate up with k
    act(() => { mockInput.pressKey("k"); });
    await renderOnce();

    // Now first call's output should be shown
    expect(captureCharFrame()).toContain("first output");
  });

  test("j/k in output mode does not change command selection", async () => {
    const calls = [
      makeCall({ command: "echo first", output: "first output" }),
      makeCall({ command: "echo second", output: "second output" }),
    ];

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    // Focus output panel
    act(() => { mockInput.pressKey("l"); });
    await renderOnce();

    // Press k — should scroll, not change command
    act(() => { mockInput.pressKey("k"); });
    await renderOnce();

    // Still on second (last) command
    expect(captureCharFrame()).toContain("second output");
    expect(captureCharFrame()).toContain("scroll output");
  });

  // ── Sidebar toggle ────────────────────────────────────────────────────────────

  test("b toggles sidebar visibility", async () => {
    const calls = [
      makeCall({ command: "cmd-one" }),
      makeCall({ command: "cmd-two" }),
    ];

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    // Sidebar visible — hint says "hide sidebar"
    expect(captureCharFrame()).toContain("hide sidebar");

    // Hide it
    act(() => { mockInput.pressKey("b"); });
    await renderOnce();

    // Hint flips to "show sidebar"
    expect(captureCharFrame()).toContain("show sidebar");
    // cmd-one is NOT the selected call (last is selected) so it only appears in sidebar
    // With sidebar hidden, cmd-one should not appear
    expect(captureCharFrame()).not.toContain("cmd-one");
  });

  test("pressing b while sidebar focused auto-focuses output", async () => {
    const calls = [makeCall()];

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    // Sidebar is focused — hiding it should auto-focus output
    act(() => { mockInput.pressKey("b"); });
    await renderOnce();

    expect(captureCharFrame()).toContain("scroll output");
  });

  test("pressing h while sidebar is hidden re-shows it and focuses it", async () => {
    const calls = [
      makeCall({ command: "cmd-alpha" }),
      makeCall({ command: "cmd-beta" }),
    ];

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <BashOutputView calls={calls} onClose={createSpy()} />,
      { width: 120, height: 25 }
    );
    await renderOnce();

    // Hide sidebar
    act(() => { mockInput.pressKey("b"); });
    await renderOnce();

    // h should re-show and re-focus sidebar
    act(() => { mockInput.pressKey("h"); });
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("navigate");
    expect(frame).toContain("hide sidebar");
    expect(frame).toContain("cmd-alpha");
  });
});
