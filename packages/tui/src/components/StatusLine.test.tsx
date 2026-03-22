import { test, expect, describe } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { StatusLine } from "./StatusLine.tsx";
import type { ChangeStats } from "@dough/protocol";

const emptyStats: ChangeStats = {
  filesChanged: 0,
  totalAdded: 0,
  totalRemoved: 0,
  files: [],
};

const someStats: ChangeStats = {
  filesChanged: 3,
  totalAdded: 42,
  totalRemoved: 7,
  files: [
    { filePath: "a.ts", linesAdded: 20, linesRemoved: 5, status: "modified" },
    { filePath: "b.ts", linesAdded: 22, linesRemoved: 0, status: "added" },
    { filePath: "c.ts", linesAdded: 0, linesRemoved: 2, status: "deleted" },
  ],
};

describe("StatusLine", () => {
  test("returns null when no changes", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <StatusLine stats={emptyStats} diffModeHint="" />,
      { width: 80, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    // Should be empty or whitespace only
    expect(frame.trim()).toBe("");
  });

  test("shows file count and line stats", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <StatusLine stats={someStats} diffModeHint="Ctrl+D for diffs" />,
      { width: 80, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("3 files changed");
    expect(frame).toContain("+42");
    expect(frame).toContain("-7");
  });

  test("shows diff mode hint", async () => {
    const { captureCharFrame, renderOnce } = await testRender(
      <StatusLine stats={someStats} diffModeHint="Ctrl+D for diffs" />,
      { width: 80, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("Ctrl+D for diffs");
  });

  test("uses singular 'file' for 1 file", async () => {
    const oneFile: ChangeStats = {
      filesChanged: 1,
      totalAdded: 5,
      totalRemoved: 2,
      files: [
        { filePath: "x.ts", linesAdded: 5, linesRemoved: 2, status: "modified" },
      ],
    };

    const { captureCharFrame, renderOnce } = await testRender(
      <StatusLine stats={oneFile} diffModeHint="" />,
      { width: 80, height: 3 }
    );
    await renderOnce();
    const frame = captureCharFrame();

    expect(frame).toContain("1 file changed");
    expect(frame).not.toContain("1 files");
  });
});
