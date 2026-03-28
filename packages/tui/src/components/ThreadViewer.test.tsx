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

    expect(frame).toContain("All Threads");
    // Header shows "N threads across M session(s)"
    expect(frame).toContain("1 threads");
    expect(frame).toContain("aaaa-bbb");
    expect(frame).toContain("(active)");
    expect(frame).toContain("5msg");
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

    // Header shows "N threads across M session(s)"
    expect(frame).toContain("2 threads");
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
      await new Promise(r => setTimeout(r, 500));
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

  // ── Keyboard-driven selection (not viewport scroll) ────────────────────────

  // Helper: given a flat frame string, return the line that contains `str`
  function lineContaining(frame: string, str: string): string | undefined {
    return frame.split("\n").find((l) => l.includes(str));
  }

  test("j moves selection cursor to next thread", async () => {
    const t1 = makeThread({ id: "aaaa-1111-1111-1111", summary: "first thread" });
    const t2 = makeThread({ id: "bbbb-2222-2222-2222", summary: "second thread",
      parentThreadId: t1.id, origin: "handoff" });

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <ThreadViewer threads={[t1, t2]} activeThreadId={t1.id} onClose={createSpy()} />,
      { width: 100, height: 20 }
    );
    await renderOnce();

    // Before — cursor (❯) on first thread's line
    const frameBefore = captureCharFrame();
    expect(lineContaining(frameBefore, "aaaa-111")).toContain("❯");
    expect(lineContaining(frameBefore, "bbbb-222")).not.toContain("❯");

    act(() => { mockInput.pressKey("j"); });
    await renderOnce();
    const frameAfter = captureCharFrame();

    // After — cursor should be on second thread's line
    expect(lineContaining(frameAfter, "bbbb-222")).toContain("❯");
    expect(lineContaining(frameAfter, "aaaa-111")).not.toContain("❯");
  });

  test("k moves selection cursor back up", async () => {
    const t1 = makeThread({ id: "cccc-1111-1111-1111" });
    const t2 = makeThread({ id: "dddd-2222-2222-2222",
      parentThreadId: t1.id, origin: "handoff" });

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <ThreadViewer threads={[t1, t2]} activeThreadId={t1.id} onClose={createSpy()} />,
      { width: 100, height: 20 }
    );
    await renderOnce();

    act(() => { mockInput.pressKey("j"); });
    await renderOnce();
    act(() => { mockInput.pressKey("k"); });
    await renderOnce();
    const frame = captureCharFrame();

    // Cursor back on first thread
    expect(lineContaining(frame, "cccc-111")).toContain("❯");
    expect(lineContaining(frame, "dddd-222")).not.toContain("❯");
  });

  test("j/k cannot navigate past the last/first thread (clamps at boundaries)", async () => {
    const t1 = makeThread({ id: "iiii-1111-1111-1111" });
    const t2 = makeThread({ id: "jjjj-2222-2222-2222",
      parentThreadId: t1.id, origin: "handoff" });

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <ThreadViewer threads={[t1, t2]} activeThreadId={t1.id} onClose={createSpy()} />,
      { width: 100, height: 20 }
    );
    await renderOnce();

    // Navigate to last then press j again — should stay on last
    act(() => { mockInput.pressKey("j"); });
    await renderOnce();
    act(() => { mockInput.pressKey("j"); });
    await renderOnce();

    // Cursor should still be on second thread (didn't wrap or move beyond)
    const frame = captureCharFrame();
    expect(lineContaining(frame, "jjjj-222")).toContain("❯");
  });

  test("auto-scroll brings off-screen thread into view when navigating down", async () => {
    // CHROME_ROWS=5, viewport height = 20 - 5 = 15 lines.
    // 1 session header = 2 lines, then each thread = 1 line → ~13 threads fit initially.
    // Use ids with unique 8-char prefixes: "s00-aaaa", "s01-aaaa", …, "s17-aaaa"
    const threads: ThreadMeta[] = [];
    let prev: string | undefined;
    for (let i = 0; i < 18; i++) {
      const t = makeThread({
        id: `s${String(i).padStart(2, "0")}-aaaa-aaaa-aaaa`,
        parentThreadId: prev,
        origin: prev ? "handoff" : "root",
      });
      threads.push(t);
      prev = t.id;
    }

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <ThreadViewer threads={threads} activeThreadId={threads[0]!.id} onClose={createSpy()} />,
      { width: 100, height: 20 }
    );
    await renderOnce();

    // Last thread (s17-aaa) should not be visible before scrolling
    expect(captureCharFrame()).not.toContain("s17-aaa");

    // Navigate all the way down to the last thread
    act(() => {
      for (let i = 0; i < 17; i++) mockInput.pressKey("j");
    });
    await renderOnce();

    // After scrolling into view, last thread must appear in the frame
    expect(captureCharFrame()).toContain("s17-aaa");
  });

  test("auto-scroll brings off-screen thread into view when navigating up", async () => {
    const threads: ThreadMeta[] = [];
    let prev: string | undefined;
    for (let i = 0; i < 18; i++) {
      const t = makeThread({
        id: `r${String(i).padStart(2, "0")}-bbbb-bbbb-bbbb`,
        parentThreadId: prev,
        origin: prev ? "handoff" : "root",
      });
      threads.push(t);
      prev = t.id;
    }

    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <ThreadViewer threads={threads} activeThreadId={threads[0]!.id} onClose={createSpy()} />,
      { width: 100, height: 20 }
    );
    await renderOnce();

    // Navigate all the way to the bottom then back to the top
    act(() => {
      for (let i = 0; i < 17; i++) mockInput.pressKey("j");
    });
    await renderOnce();

    act(() => {
      for (let i = 0; i < 17; i++) mockInput.pressKey("k");
    });
    await renderOnce();

    // First thread must be visible again after scrolling back up
    expect(captureCharFrame()).toContain("r00-bbb");
  });
});
