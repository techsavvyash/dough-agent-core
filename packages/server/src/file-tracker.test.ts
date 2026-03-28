import { test, expect, beforeEach, afterEach } from "bun:test";
import { FileTracker } from "./file-tracker.ts";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

let tracker: FileTracker;
let tmpDir: string;

beforeEach(async () => {
  tracker = new FileTracker();
  tmpDir = await mkdtemp(join(tmpdir(), "dough-tracker-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeFile(name: string, content: string): Promise<string> {
  const path = join(tmpDir, name);
  await Bun.write(path, content);
  return path;
}

test("empty tracker returns zero stats", () => {
  const stats = tracker.getStats();
  expect(stats.filesChanged).toBe(0);
  expect(stats.totalAdded).toBe(0);
  expect(stats.totalRemoved).toBe(0);
  expect(stats.files).toHaveLength(0);
});

test("tracks a new file creation", async () => {
  const path = join(tmpDir, "new.ts");

  // Snapshot before — file doesn't exist yet
  await tracker.snapshotBefore(path);

  // Write the file
  await Bun.write(path, "const x = 1;\nconst y = 2;\n");

  // Record after
  await tracker.recordAfter(path);

  const stats = tracker.getStats();
  expect(stats.filesChanged).toBe(1);
  expect(stats.totalAdded).toBe(2);
  expect(stats.totalRemoved).toBe(0);
  expect(stats.files[0].status).toBe("added");
});

test("tracks a file modification", async () => {
  const path = await writeFile("existing.ts", "line1\nline2\nline3\n");

  await tracker.snapshotBefore(path);

  // Modify the file
  await Bun.write(path, "line1\nmodified\nline3\nnewline\n");

  await tracker.recordAfter(path);

  const stats = tracker.getStats();
  expect(stats.filesChanged).toBe(1);
  expect(stats.files[0].status).toBe("modified");
  expect(stats.files[0].linesAdded).toBeGreaterThan(0);
  expect(stats.files[0].linesRemoved).toBeGreaterThan(0);
});

test("tracks a file deletion", async () => {
  const path = await writeFile("to-delete.ts", "will be deleted\n");

  await tracker.recordDelete(path);

  // Now actually delete the file
  await rm(path);

  // Record the deletion
  await tracker.recordAfter(path);

  const stats = tracker.getStats();
  expect(stats.filesChanged).toBe(1);
  expect(stats.files[0].status).toBe("deleted");
  expect(stats.files[0].linesRemoved).toBeGreaterThan(0);
});

test("only snapshots first 'before' for a file", async () => {
  const path = await writeFile("multi.ts", "original\n");

  await tracker.snapshotBefore(path);

  // Overwrite file
  await Bun.write(path, "changed once\n");

  // Second snapshot should be a no-op (first content is kept)
  await tracker.snapshotBefore(path);

  await Bun.write(path, "changed twice\n");
  await tracker.recordAfter(path);

  const diffs = tracker.getDiffs("test-session");
  // Diff should show "original" → "changed twice", not "changed once" → "changed twice"
  expect(diffs.diffs[0].unifiedDiff).toContain("-original");
  expect(diffs.diffs[0].unifiedDiff).toContain("+changed twice");
});

test("tracks multiple files", async () => {
  const path1 = join(tmpDir, "a.ts");
  const path2 = await writeFile("b.ts", "old content\n");

  await tracker.snapshotBefore(path1);
  await tracker.snapshotBefore(path2);

  await Bun.write(path1, "new file\n");
  await Bun.write(path2, "new content\n");

  await tracker.recordAfter(path1);
  await tracker.recordAfter(path2);

  const stats = tracker.getStats();
  expect(stats.filesChanged).toBe(2);
});

test("getDiffs returns unified diff strings", async () => {
  const path = await writeFile("diff-test.ts", "hello\nworld\n");

  await tracker.snapshotBefore(path);
  await Bun.write(path, "hello\nuniverse\n");
  await tracker.recordAfter(path);

  const payload = tracker.getDiffs("session-1", "thread-1");
  expect(payload.sessionId).toBe("session-1");
  expect(payload.threadId).toBe("thread-1");
  expect(payload.diffs).toHaveLength(1);
  expect(payload.diffs[0].unifiedDiff).toContain("-world");
  expect(payload.diffs[0].unifiedDiff).toContain("+universe");
});

test("getDiffs detects language from extension", async () => {
  const tsPath = await writeFile("code.tsx", "old\n");
  const pyPath = await writeFile("script.py", "old\n");

  await tracker.snapshotBefore(tsPath);
  await tracker.snapshotBefore(pyPath);
  await Bun.write(tsPath, "new\n");
  await Bun.write(pyPath, "new\n");
  await tracker.recordAfter(tsPath);
  await tracker.recordAfter(pyPath);

  const payload = tracker.getDiffs("s1");
  const tsFile = payload.diffs.find((d) => d.filePath.endsWith(".tsx"));
  const pyFile = payload.diffs.find((d) => d.filePath.endsWith(".py"));
  expect(tsFile?.language).toBe("typescriptreact"); // TSX uses OpenTUI's typescriptreact alias
  expect(pyFile?.language).toBe("python");
});

test("onChange listener is called on each change", async () => {
  const updates: number[] = [];
  tracker.onChange((stats) => {
    updates.push(stats.filesChanged);
  });

  const path = join(tmpDir, "watched.ts");
  await tracker.snapshotBefore(path);
  await Bun.write(path, "content\n");
  await tracker.recordAfter(path);

  expect(updates.length).toBeGreaterThanOrEqual(1);
  expect(updates[updates.length - 1]).toBe(1);
});

test("onChange unsubscribe works", async () => {
  const updates: number[] = [];
  const unsub = tracker.onChange((stats) => {
    updates.push(stats.filesChanged);
  });

  unsub(); // unsubscribe immediately

  const path = join(tmpDir, "ignored.ts");
  await tracker.snapshotBefore(path);
  await Bun.write(path, "content\n");
  await tracker.recordAfter(path);

  expect(updates).toHaveLength(0);
});

test("reset clears all tracked state", async () => {
  const path = await writeFile("reset.ts", "original\n");
  await tracker.snapshotBefore(path);
  await Bun.write(path, "modified\n");
  await tracker.recordAfter(path);

  expect(tracker.getStats().filesChanged).toBe(1);

  tracker.reset();

  expect(tracker.getStats().filesChanged).toBe(0);
  expect(tracker.trackedCount).toBe(0);
});

test("no diff when file content unchanged", async () => {
  const path = await writeFile("same.ts", "unchanged\n");
  await tracker.snapshotBefore(path);
  // Write the same content back
  await Bun.write(path, "unchanged\n");
  await tracker.recordAfter(path);

  expect(tracker.getStats().filesChanged).toBe(0);
});
