import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createSpy } from "@opentui/core/testing";
import type { ParsedKey } from "@opentui/core";
import { act } from "react";
import { CommandPalette, COMMANDS } from "./CommandPalette.tsx";

/** Synthetic escape key — bypasses stdin parser debounce for reliable CI testing */
const ESCAPE_KEY: ParsedKey = {
  name: "escape", sequence: "\x1b", ctrl: false, meta: false,
  shift: false, option: false, number: false, raw: "\x1b",
  eventType: "press", source: "raw",
};

describe("CommandPalette", () => {
  test("renders all commands", async () => {
    const onSelect = createSpy();
    const onClose = createSpy();

    const { captureCharFrame, renderOnce } = await testRender(
      <CommandPalette commands={COMMANDS} onSelect={onSelect} onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("filter");
    // First 5 commands visible (windowed, MAX_VISIBLE=5)
    expect(frame).toContain("/thread info");
    expect(frame).toContain("/thread list");
    expect(frame).toContain("/thread fork");
    expect(frame).toContain("/clear");
    // Shows count indicator for windowed list
    expect(frame).toContain("1/7");
  });

  test("first item is selected by default", async () => {
    const onSelect = createSpy();
    const onClose = createSpy();

    const { captureCharFrame, renderOnce } = await testRender(
      <CommandPalette commands={COMMANDS} onSelect={onSelect} onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // First command should have the selector indicator
    expect(frame).toContain("❯");
  });

  test("arrow down moves selection", async () => {
    const onSelect = createSpy();
    const onClose = createSpy();

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <CommandPalette commands={COMMANDS} onSelect={onSelect} onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();

    mockInput.pressArrow("down");
    await renderOnce();

    // Selection should have moved - both commands should still be visible
    const frame = captureCharFrame();
    expect(frame).toContain("/thread info");
    expect(frame).toContain("/thread list");
  });

  test("escape calls onClose", async () => {
    const onSelect = createSpy();
    const onClose = createSpy();

    const { renderer, renderOnce } = await testRender(
      <CommandPalette commands={COMMANDS} onSelect={onSelect} onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();

    // Directly inject a pre-parsed escape key to avoid stdin-parser debounce
    // timing differences between macOS and Linux CI runners.
    renderer.keyInput.processParsedKey(ESCAPE_KEY);
    await renderOnce();

    expect(onClose.callCount()).toBe(1);
  });

  test("enter selects current command", async () => {
    const onSelect = createSpy();
    const onClose = createSpy();

    const { mockInput, renderOnce } = await testRender(
      <CommandPalette commands={COMMANDS} onSelect={onSelect} onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();

    // First item is "thread_info"
    mockInput.pressEnter();
    await renderOnce();

    expect(onSelect.callCount()).toBe(1);
    expect(onSelect.calledWith("thread_info")).toBe(true);
  });

  test("navigate down then enter selects second command", async () => {
    const onSelect = createSpy();
    const onClose = createSpy();

    const { mockInput, renderOnce } = await testRender(
      <CommandPalette commands={COMMANDS} onSelect={onSelect} onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();

    act(() => { mockInput.pressArrow("down"); });
    await renderOnce();
    act(() => { mockInput.pressEnter(); });
    await renderOnce();

    expect(onSelect.callCount()).toBe(1);
    expect(onSelect.calledWith("thread_list")).toBe(true);
  });

  test("wraps selection from last to first", async () => {
    const onSelect = createSpy();
    const onClose = createSpy();

    const { mockInput, renderOnce } = await testRender(
      <CommandPalette commands={COMMANDS} onSelect={onSelect} onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();

    // Press up from first item → wraps to last
    act(() => { mockInput.pressArrow("up"); });
    await renderOnce();
    act(() => { mockInput.pressEnter(); });
    await renderOnce();

    expect(onSelect.callCount()).toBe(1);
    // Last command is "exit"
    expect(onSelect.calledWith("exit")).toBe(true);
  });

  test("shows help text", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <CommandPalette commands={COMMANDS} onSelect={createSpy()} onClose={createSpy()} />,
      { width: 80, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("navigate");
    expect(frame).toContain("Esc");
  });
});
