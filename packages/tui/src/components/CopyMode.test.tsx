import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createSpy } from "@opentui/core/testing";
import { act } from "react";
import { CopyMode } from "./CopyMode.tsx";
import type { Message } from "../hooks/useSession.ts";

function makeMsg(
  role: "user" | "assistant" | "system",
  content: string,
): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

const testMessages: Message[] = [
  makeMsg("user", "hello world"),
  makeMsg("assistant", "Hi there! How can I help you?"),
  makeMsg("user", "what is 2+2?"),
  makeMsg("assistant", "4"),
];

describe("CopyMode", () => {
  test("renders header and footer", async () => {
    const onClose = createSpy();
    const { captureCharFrame, renderOnce } = await testRender(
      <CopyMode messages={testMessages} onClose={onClose} />,
      { width: 60, height: 20 },
    );
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("COPY");
    expect(frame).toContain("j/k move");
  });

  test("displays message content", async () => {
    const onClose = createSpy();
    const { captureCharFrame, renderOnce } = await testRender(
      <CopyMode messages={testMessages} onClose={onClose} />,
      { width: 60, height: 20 },
    );
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("hello world");
    expect(frame).toContain("How can I help you?");
  });

  test("Esc closes copy mode", async () => {
    const onClose = createSpy();
    const { mockInput, renderOnce } = await testRender(
      <CopyMode messages={testMessages} onClose={onClose} />,
      { width: 60, height: 20 },
    );
    await renderOnce();

    await act(async () => {
      mockInput.pressEscape();
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(onClose.calls.length).toBe(1);
  });

  test("q closes copy mode", async () => {
    const onClose = createSpy();
    const { mockInput, renderOnce } = await testRender(
      <CopyMode messages={testMessages} onClose={onClose} />,
      { width: 60, height: 20 },
    );
    await renderOnce();
    mockInput.pressKey("q");
    expect(onClose.calls.length).toBe(1);
  });

  test("v toggles visual mode", async () => {
    const onClose = createSpy();
    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <CopyMode messages={testMessages} onClose={onClose} />,
      { width: 60, height: 20 },
    );
    await renderOnce();

    // Enter visual mode
    await act(async () => {
      mockInput.pressKey("v");
    });
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("VISUAL");
  });

  test("Esc in visual mode exits visual first, not copy mode", async () => {
    const onClose = createSpy();
    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <CopyMode messages={testMessages} onClose={onClose} />,
      { width: 60, height: 20 },
    );
    await renderOnce();

    // Enter visual mode
    await act(async () => {
      mockInput.pressKey("v");
    });
    await renderOnce();
    expect(captureCharFrame()).toContain("VISUAL");

    // Esc exits visual, not copy mode
    await act(async () => {
      mockInput.pressEscape();
      await new Promise((r) => setTimeout(r, 150));
    });
    await renderOnce();

    expect(onClose.calls.length).toBe(0);
    expect(captureCharFrame()).toContain("COPY");
  });

  test("j/k moves cursor", async () => {
    const onClose = createSpy();
    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <CopyMode messages={testMessages} onClose={onClose} />,
      { width: 60, height: 30 },
    );
    await renderOnce();
    const frame1 = captureCharFrame();

    // Move up
    await act(async () => {
      mockInput.pressKey("k");
    });
    await renderOnce();
    const frame2 = captureCharFrame();

    // Frames should differ (cursor moved)
    expect(frame1).not.toBe(frame2);
  });

  test("shows empty state when no messages", async () => {
    const onClose = createSpy();
    const { captureCharFrame, renderOnce } = await testRender(
      <CopyMode messages={[]} onClose={onClose} />,
      { width: 60, height: 20 },
    );
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("COPY");
  });
});
