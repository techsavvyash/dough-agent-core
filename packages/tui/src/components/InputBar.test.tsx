import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createSpy } from "@opentui/core/testing";
import { act } from "react";
import { InputBar } from "./InputBar.tsx";

describe("InputBar", () => {
  test("shows placeholder when idle", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <InputBar onSubmit={createSpy()} isStreaming={false} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("❯");
    expect(frame).toContain("Type a message");
    expect(frame).toContain("? for commands");
  });

  test("shows streaming placeholder when streaming", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <InputBar onSubmit={createSpy()} isStreaming={true} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("◐");
    expect(frame).toContain("Thinking");
    expect(frame).toContain("Esc to cancel");
  });

  test("renders horizontal rule separator", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <InputBar onSubmit={createSpy()} isStreaming={false} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("─");
  });

  test("submits typed text on enter", async () => {
    const onSubmit = createSpy();
    const { mockInput, renderOnce } = await testRender(
      <InputBar onSubmit={onSubmit} isStreaming={false} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();

    await mockInput.typeText("hello world");
    await renderOnce();
    mockInput.pressEnter();
    await renderOnce();

    expect(onSubmit.callCount()).toBe(1);
    expect(onSubmit.calledWith("hello world")).toBe(true);
  });

  test("does not submit empty text", async () => {
    const onSubmit = createSpy();
    const { mockInput, renderOnce } = await testRender(
      <InputBar onSubmit={onSubmit} isStreaming={false} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();

    mockInput.pressEnter();
    await renderOnce();

    expect(onSubmit.callCount()).toBe(0);
  });

  test("does not submit while streaming", async () => {
    const onSubmit = createSpy();
    const { mockInput, renderOnce } = await testRender(
      <InputBar onSubmit={onSubmit} isStreaming={true} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();

    await mockInput.typeText("test");
    await renderOnce();
    mockInput.pressEnter();
    await renderOnce();

    expect(onSubmit.callCount()).toBe(0);
  });

  test("no timer shown when idle", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <InputBar onSubmit={createSpy()} isStreaming={false} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).not.toContain("[");
    expect(frame).not.toContain("s]");
  });

  test("timer appears after 1 second of streaming", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <InputBar onSubmit={createSpy()} isStreaming={true} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();

    // Initially no timer (elapsed=0)
    let frame = captureCharFrame();
    expect(frame).toContain("Thinking...");
    expect(frame).not.toContain("[1s]");

    // Advance 1 second
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1050));
    });
    await renderOnce();

    frame = captureCharFrame();
    expect(frame).toContain("[1s]");
    expect(frame).toContain("Esc to cancel");
  });

  test("timer increments past 1 second", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <InputBar onSubmit={createSpy()} isStreaming={true} onAbort={createSpy()} />,
      { width: 80, height: 4 }
    );
    await renderOnce();

    // Advance ~2 seconds
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2050));
    });
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("[2s]");
  });

  test("escape calls onAbort while streaming", async () => {
    const onAbort = createSpy();
    const { mockInput, renderOnce } = await testRender(
      <InputBar onSubmit={createSpy()} isStreaming={true} onAbort={onAbort} />,
      { width: 80, height: 4 }
    );
    await renderOnce();

    await act(async () => {
      mockInput.pressEscape();
      await new Promise(r => setTimeout(r, 500));
    });
    await renderOnce();

    expect(onAbort.callCount()).toBe(1);
  });
});
