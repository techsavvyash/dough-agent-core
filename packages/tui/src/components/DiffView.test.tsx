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
    // showLineNumbers=true prefixes lines with "N + content"; match without leading "+"
    expect(frame).toContain("export function add");
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

    // Selection indicator on first file (sidebar uses ▶ as the cursor glyph)
    expect(frame).toContain("▶");
    // First file's diff content shown (showLineNumbers=true adds "N - content" prefix)
    expect(frame).toContain("const old = true");
  });

  // ── Responsiveness ──────────────────────────────────────────────────────────

  test("word-wrap: long diff lines wrap and remain fully visible in a narrow terminal", async () => {
    // Build a payload with a diff line intentionally wider than the diff panel.
    // At width=70: FILE_LIST_W = min(34, floor(70 * 0.22)) = 15
    // Diff panel ≈ 70 - 15 (sidebar) - 1 (border) - 5 (line-number gutter) ≈ 49 cols.
    // The added line below is 80+ characters — it must wrap to stay readable.
    const longLine = "+const " + "a".repeat(30) + " = " + "b".repeat(30) + ";";
    const wrapPayload: DiffPayload = {
      sessionId: "s1",
      stats: { filesChanged: 1, totalAdded: 1, totalRemoved: 0, files: [
        { filePath: "src/long.ts", linesAdded: 1, linesRemoved: 0, status: "modified" },
      ]},
      diffs: [{
        filePath: "src/long.ts",
        status: "modified",
        linesAdded: 1,
        linesRemoved: 0,
        language: "typescript",
        unifiedDiff: [
          "--- src/long.ts\toriginal",
          "+++ src/long.ts\tmodified",
          "@@ -1,1 +1,2 @@",
          " export {};",
          longLine,
        ].join("\n"),
      }],
    };

    const { captureCharFrame, renderOnce } = await testRender(
      <DiffView payload={wrapPayload} onClose={createSpy()} />,
      { width: 70, height: 35 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // The tail segment of the long line must appear somewhere in the frame.
    // If wrapping were off, anything past ~49 chars would be clipped and "bbb...;" would never show.
    const tail = "b".repeat(10); // unambiguous suffix from the 30-b run
    expect(frame).toContain(tail);
  });

  test("pressing b hides the file list sidebar", async () => {
    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={createSpy()} />,
      { width: 120, height: 30 }
    );
    await renderOnce();

    // Sidebar visible initially — hint says "hide files"
    expect(captureCharFrame()).toContain("hide files");

    // Hide the sidebar
    act(() => { mockInput.pressKey("b"); });
    await renderOnce();
    const frame = captureCharFrame();

    // Hint flips to "show files"
    expect(frame).toContain("show files");
    // utils.ts only appears in the sidebar (index.ts is the selected file shown in diff panel header).
    // With the sidebar hidden, utils.ts must not appear anywhere in the frame.
    expect(frame).not.toContain("utils.ts");
  });

  test("pressing b twice restores the file list sidebar", async () => {
    const { captureCharFrame, mockInput, renderOnce } = await testRender(
      <DiffView payload={samplePayload} onClose={createSpy()} />,
      { width: 120, height: 30 }
    );
    await renderOnce();

    // Hide then show
    act(() => { mockInput.pressKey("b"); });
    await renderOnce();
    act(() => { mockInput.pressKey("b"); });
    await renderOnce();
    const frame = captureCharFrame();

    // Hint back to "hide files" and sidebar entries visible again
    expect(frame).toContain("hide files");
    expect(frame).toContain("index.ts");
  });
});
