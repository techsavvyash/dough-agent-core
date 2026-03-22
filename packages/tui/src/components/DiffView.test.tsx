import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createSpy } from "@opentui/core/testing";
import { act } from "react";
import { DiffView } from "./DiffView.tsx";
import type { DiffPayload } from "@dough/protocol";

const emptyPayload: DiffPayload = {
  sessionId: "s1",
  stats: { filesChanged: 0, totalAdded: 0, totalRemoved: 0, files: [] },
  diffs: [],
};

const samplePayload: DiffPayload = {
  sessionId: "s1",
  threadId: "t1",
  stats: {
    filesChanged: 2,
    totalAdded: 10,
    totalRemoved: 3,
    files: [
      { filePath: "src/index.ts", linesAdded: 5, linesRemoved: 2, status: "modified" },
      { filePath: "src/utils.ts", linesAdded: 5, linesRemoved: 1, status: "added" },
    ],
  },
  diffs: [
    {
      filePath: "src/index.ts",
      status: "modified",
      linesAdded: 5,
      linesRemoved: 2,
      language: "typescript",
      unifiedDiff: [
        "--- src/index.ts\toriginal",
        "+++ src/index.ts\tmodified",
        "@@ -1,5 +1,8 @@",
        " import { foo } from './foo';",
        "-const old = true;",
        "-const legacy = false;",
        "+const updated = true;",
        "+const modern = true;",
        "+const extra1 = 1;",
        "+const extra2 = 2;",
        "+const extra3 = 3;",
        " export default foo;",
      ].join("\n"),
    },
    {
      filePath: "src/utils.ts",
      status: "added",
      linesAdded: 5,
      linesRemoved: 1,
      language: "typescript",
      unifiedDiff: [
        "--- src/utils.ts\toriginal",
        "+++ src/utils.ts\tmodified",
        "@@ -0,0 +1,5 @@",
        "+export function add(a: number, b: number) {",
        "+  return a + b;",
        "+}",
        "+",
        "+export const PI = 3.14;",
      ].join("\n"),
    },
  ],
};

describe("DiffView", () => {
  test("shows empty message when no diffs", async () => {
    const onClose = createSpy();
    const { captureCharFrame, renderOnce } = await testRender(
      <DiffView payload={emptyPayload} onClose={onClose} />,
      { width: 100, height: 20 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("No file changes");
  });

  test("shows header with file count and line stats", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={createSpy()} />,
      { width: 120, height: 30 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Changes");
    expect(frame).toContain("2 files");
    expect(frame).toContain("+10");
    expect(frame).toContain("-3");
  });

  test("shows file list with status indicators", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={createSpy()} />,
      { width: 120, height: 30 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // File names shown
    expect(frame).toContain("index.ts");
    expect(frame).toContain("utils.ts");
    // Status indicators
    expect(frame).toContain("M");
    expect(frame).toContain("A");
  });

  test("shows unified diff content for selected file", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={createSpy()} />,
      { width: 120, height: 30 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // First file (src/index.ts) is selected by default
    expect(frame).toContain("src/index.ts");
    // Diff hunk header
    expect(frame).toContain("@@");
    // Removed lines
    expect(frame).toContain("-const old = true");
    // Added lines
    expect(frame).toContain("+const updated = true");
    // Context lines
    expect(frame).toContain("import { foo }");
  });

  test("j/k navigates between files", async () => {
    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={createSpy()} />,
      { width: 120, height: 30 }
    );
    await renderOnce();

    // Navigate to second file
    act(() => { mockInput.pressKey("j"); });
    await renderOnce();
    const frame = captureCharFrame();

    // Second file diff should now be visible in the diff panel
    expect(frame).toContain("src/utils.ts");
    expect(frame).toContain("+export function add");
  });

  test("escape closes the diff view", async () => {
    const onClose = createSpy();
    const { mockInput, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={onClose} />,
      { width: 120, height: 30 }
    );
    await renderOnce();

    await act(async () => {
      mockInput.pressEscape();
      await new Promise(r => setTimeout(r, 150));
    });
    await renderOnce();

    expect(onClose.callCount()).toBe(1);
  });

  test("shows navigation hint", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={createSpy()} />,
      { width: 120, height: 30 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("navigate");
    expect(frame).toContain("Esc");
  });

  test("first file is selected by default", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={createSpy()} />,
      { width: 120, height: 30 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Selection indicator on first file
    expect(frame).toContain("❯");
    // First file's diff content shown
    expect(frame).toContain("-const old = true");
  });
});
