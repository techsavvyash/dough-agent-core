import { test, expect, beforeEach, afterEach } from "bun:test";
import { loadAgentsMd, buildAgentsContext } from "./agents-md.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "agents-md-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("returns empty when no files exist", async () => {
  const result = await loadAgentsMd(tempDir);
  expect(result.entries).toHaveLength(0);
  expect(result.merged).toBe("");
});

test("discovers AGENTS.md in cwd", async () => {
  await Bun.write(join(tempDir, "AGENTS.md"), "# Project\nUse bun.");
  const result = await loadAgentsMd(tempDir);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].content).toBe("# Project\nUse bun.");
});

test("AGENTS.override.md replaces AGENTS.md at same level", async () => {
  await Bun.write(join(tempDir, "AGENTS.md"), "original");
  await Bun.write(join(tempDir, "AGENTS.override.md"), "override");
  const result = await loadAgentsMd(tempDir);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].content).toBe("override");
  expect(result.entries[0].isOverride).toBe(true);
});

test("falls back to CLAUDE.md when no AGENTS.md exists", async () => {
  await Bun.write(join(tempDir, "CLAUDE.md"), "claude instructions");
  const result = await loadAgentsMd(tempDir);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].content).toBe("claude instructions");
});

test("AGENTS.md takes priority over CLAUDE.md", async () => {
  await Bun.write(join(tempDir, "AGENTS.md"), "agents");
  await Bun.write(join(tempDir, "CLAUDE.md"), "claude");
  const result = await loadAgentsMd(tempDir);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].content).toBe("agents");
});

test("merges parent and child directory files", async () => {
  // Simulate git root
  await Bun.write(join(tempDir, ".git/HEAD"), "ref: refs/heads/main\n");
  await Bun.write(join(tempDir, "AGENTS.md"), "root instructions");

  const subDir = join(tempDir, "packages", "core");
  await Bun.write(join(subDir, "AGENTS.md"), "core instructions");

  const result = await loadAgentsMd(subDir);
  expect(result.entries.length).toBeGreaterThanOrEqual(1);
  // Root should come first in merged
  expect(result.merged).toContain("root instructions");
  expect(result.merged).toContain("core instructions");
  expect(result.merged.indexOf("root")).toBeLessThan(
    result.merged.indexOf("core")
  );
});

test("strips YAML frontmatter", async () => {
  await Bun.write(
    join(tempDir, "AGENTS.md"),
    "---\ndescription: test\n---\nActual content"
  );
  const result = await loadAgentsMd(tempDir);
  expect(result.entries[0].content).toBe("Actual content");
});

test("skips empty files", async () => {
  await Bun.write(join(tempDir, "AGENTS.md"), "   ");
  const result = await loadAgentsMd(tempDir);
  expect(result.entries).toHaveLength(0);
});

test("buildAgentsContext returns formatted string", async () => {
  await Bun.write(join(tempDir, "AGENTS.md"), "# My Project\nDo stuff.");
  const ctx = await buildAgentsContext(tempDir);
  expect(ctx).toContain("Project Instructions");
  expect(ctx).toContain("# My Project\nDo stuff.");
});
