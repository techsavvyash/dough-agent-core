import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createSpy } from "@opentui/core/testing";
import { act } from "react";
import { Composer } from "./Composer.tsx";
import type { ChangeStats } from "@dough/protocol";

const emptyStats: ChangeStats = {
  filesChanged: 0,
  totalAdded: 0,
  totalRemoved: 0,
  files: [],
};

const fileStats: ChangeStats = {
  filesChanged: 3,
  totalAdded: 42,
  totalRemoved: 8,
  files: [
    { filePath: "a.ts", linesAdded: 20, linesRemoved: 4, status: "modified" },
    { filePath: "b.ts", linesAdded: 12, linesRemoved: 2, status: "modified" },
    { filePath: "c.ts", linesAdded: 10, linesRemoved: 2, status: "modified" },
  ],
};

describe("Composer", () => {
  test("renders input prompt when idle", async () => {
    const onSubmit = createSpy();
    const onAbort = createSpy();

    const { captureCharFrame, renderOnce } = await testRender(
      <Composer
        onSubmit={onSubmit}
        isStreaming={false}
        queuedCount={0}
        onAbort={onAbort}
        stats={emptyStats}
        hasChanges={false}
      />,
      { width: 60, height: 10 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Type a message");
    expect(frame).toContain("? commands");
  });

  test("shows thinking state when streaming", async () => {
    const onSubmit = createSpy();
    const onAbort = createSpy();

    const { captureCharFrame, renderOnce } = await testRender(
      <Composer
        onSubmit={onSubmit}
        isStreaming={true}
        queuedCount={0}
        onAbort={onAbort}
        stats={emptyStats}
        hasChanges={false}
      />,
      { width: 60, height: 10 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Thinking...");
    expect(frame).toContain("Esc cancel");
  });

  test("shows file stats in footer when files changed", async () => {
    const onSubmit = createSpy();
    const onAbort = createSpy();

    const { captureCharFrame, renderOnce } = await testRender(
      <Composer
        onSubmit={onSubmit}
        isStreaming={false}
        queuedCount={0}
        onAbort={onAbort}
        stats={fileStats}
        hasChanges={true}
      />,
      { width: 80, height: 10 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("3 files changed");
    expect(frame).toContain("+42");
    expect(frame).toContain("-8");
    expect(frame).toContain("Ctrl+D diffs");
  });

  test("shows timer after 1 second of streaming", async () => {
    const onSubmit = createSpy();
    const onAbort = createSpy();

    const { captureCharFrame, renderOnce } = await testRender(
      <Composer
        onSubmit={onSubmit}
        isStreaming={true}
        queuedCount={0}
        onAbort={onAbort}
        stats={emptyStats}
        hasChanges={false}
      />,
      { width: 60, height: 10 }
    );
    await renderOnce();

    // Advance timer
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1050));
    });
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("[1s]");
  });

  test("submits text and clears input", async () => {
    const onSubmit = createSpy();
    const onAbort = createSpy();

    const { mockInput, renderOnce } = await testRender(
      <Composer
        onSubmit={onSubmit}
        isStreaming={false}
        queuedCount={0}
        onAbort={onAbort}
        stats={emptyStats}
        hasChanges={false}
      />,
      { width: 60, height: 10 }
    );
    await renderOnce();

    mockInput.typeText("hello world");
    mockInput.pressEnter();
    await renderOnce();

    expect(onSubmit.calls).toHaveLength(1);
    expect(onSubmit.calls[0]![0]).toBe("hello world");
  });

  test("does not submit empty text", async () => {
    const onSubmit = createSpy();
    const onAbort = createSpy();

    const { mockInput, renderOnce } = await testRender(
      <Composer
        onSubmit={onSubmit}
        isStreaming={false}
        queuedCount={0}
        onAbort={onAbort}
        stats={emptyStats}
        hasChanges={false}
      />,
      { width: 60, height: 10 }
    );
    await renderOnce();

    mockInput.pressEnter();
    await renderOnce();

    expect(onSubmit.calls).toHaveLength(0);
  });

  test("does not show diff hint when no changes", async () => {
    const onSubmit = createSpy();
    const onAbort = createSpy();

    const { captureCharFrame, renderOnce } = await testRender(
      <Composer
        onSubmit={onSubmit}
        isStreaming={false}
        queuedCount={0}
        onAbort={onAbort}
        stats={emptyStats}
        hasChanges={false}
      />,
      { width: 60, height: 10 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).not.toContain("Ctrl+D");
  });
});
