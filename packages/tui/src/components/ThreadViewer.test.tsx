import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createSpy } from "@opentui/core/testing";
import { act } from "react";
import { ThreadViewer } from "./ThreadViewer.tsx";
import type { ThreadMeta } from "@dough/protocol";

function makeThread(overrides: Partial<ThreadMeta> = {}): ThreadMeta {
  return {
    id: crypto.randomUUID(),
    sessionId: "s1",
    origin: "root",
    status: "active",
    tokenCount: 0,
    maxTokens: 200_000,
    messageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ThreadViewer", () => {
  test("shows empty message when no threads", async () => {
    const onClose = createSpy();
    const { captureCharFrame, renderOnce } = await testRender(
      <ThreadViewer threads={[]} activeThreadId="" onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("No threads");
  });

  test("renders a root thread", async () => {
    const thread = makeThread({
      id: "aaaa-bbbb-cccc-dddd",
      messageCount: 5,
      tokenCount: 1000,
    });
    const onClose = createSpy();

    const { captureCharFrame, renderOnce } = await testRender(
      <ThreadViewer threads={[thread]} activeThreadId={thread.id} onClose={onClose} />,
      { width: 100, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Threads");
    expect(frame).toContain("1 total");
    expect(frame).toContain("aaaa-bbb");
    expect(frame).toContain("(active)");
    expect(frame).toContain("5 msgs");
    // Root origin indicator
    expect(frame).toContain("○");
  });

  test("renders thread tree with parent-child", async () => {
    const root = makeThread({
      id: "root-0000-0000-0000",
      origin: "root",
      status: "full",
      messageCount: 10,
      tokenCount: 200_000,
    });
    const handoff = makeThread({
      id: "hand-1111-1111-1111",
      parentThreadId: root.id,
      origin: "handoff",
      status: "active",
      messageCount: 3,
      tokenCount: 5000,
    });

    const onClose = createSpy();
    const { captureCharFrame, renderOnce } = await testRender(
      <ThreadViewer
        threads={[root, handoff]}
        activeThreadId={handoff.id}
        onClose={onClose}
      />,
      { width: 100, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("2 total");
    // Root thread
    expect(frame).toContain("○");
    // Handoff indicator
    expect(frame).toContain("→");
    // Tree connector
    expect(frame).toContain("└─");
  });

  test("renders fork indicator", async () => {
    const root = makeThread({ id: "root-id-00" });
    const fork = makeThread({
      id: "fork-id-00",
      parentThreadId: root.id,
      origin: "fork",
    });

    const { captureCharFrame, renderOnce } = await testRender(
      <ThreadViewer
        threads={[root, fork]}
        activeThreadId={root.id}
        onClose={createSpy()}
      />,
      { width: 100, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Fork symbol
    expect(frame).toContain("⑂");
  });

  test("escape closes viewer", async () => {
    const onClose = createSpy();
    const thread = makeThread();

    const { mockInput, renderOnce } = await testRender(
      <ThreadViewer threads={[thread]} activeThreadId={thread.id} onClose={onClose} />,
      { width: 80, height: 20 }
    );
    await renderOnce();

    await act(async () => {
      mockInput.pressEscape();
      await new Promise(r => setTimeout(r, 150));
    });
    await renderOnce();

    expect(onClose.callCount()).toBe(1);
  });

  test("shows detail panel on enter", async () => {
    const thread = makeThread({
      id: "detail-test-0000",
      messageCount: 7,
      tokenCount: 50_000,
      maxTokens: 200_000,
    });

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <ThreadViewer threads={[thread]} activeThreadId={thread.id} onClose={createSpy()} />,
      { width: 120, height: 24 }
    );
    await renderOnce();

    act(() => { mockInput.pressEnter(); });
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Thread Detail");
    expect(frame).toContain("detail-test-0000");
    expect(frame).toContain("Root thread");
    expect(frame).toContain("Messages:");
    expect(frame).toContain("Tokens:");
  });

  test("j/k navigation works", async () => {
    const t1 = makeThread({ id: "first-thread-00" });
    const t2 = makeThread({
      id: "second-thread-0",
      parentThreadId: t1.id,
      origin: "handoff",
    });

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <ThreadViewer threads={[t1, t2]} activeThreadId={t1.id} onClose={createSpy()} />,
      { width: 100, height: 20 }
    );
    await renderOnce();

    // Navigate down with j
    mockInput.pressKey("j");
    await renderOnce();

    // Both threads should still be visible
    const frame = captureCharFrame();
    expect(frame).toContain("first-th");
    expect(frame).toContain("second-t");
  });

  test("shows legend with all indicators", async () => {
    const thread = makeThread();
    const { captureCharFrame, renderOnce } = await testRender(
      <ThreadViewer threads={[thread]} activeThreadId={thread.id} onClose={createSpy()} />,
      { width: 100, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("active");
    expect(frame).toContain("full");
    expect(frame).toContain("archived");
    expect(frame).toContain("handoff");
    expect(frame).toContain("fork");
    expect(frame).toContain("root");
  });

  test("token bar shows percentage", async () => {
    const thread = makeThread({
      tokenCount: 180_000,
      maxTokens: 200_000,
    });

    const { captureCharFrame, renderOnce } = await testRender(
      <ThreadViewer threads={[thread]} activeThreadId={thread.id} onClose={createSpy()} />,
      { width: 100, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("90%");
    // Should have filled blocks
    expect(frame).toContain("█");
  });
});
