import { describe, test, expect } from "bun:test";
import { executeTool } from "../executor.ts";

const CWD = import.meta.dirname ?? process.cwd();

describe("executeTool", () => {
  // ── Bash ──────────────────────────────────────────────────────

  test("Bash: runs a command and returns stdout", async () => {
    const result = await executeTool("Bash", { command: "echo hello" }, CWD);
    expect(result.isError).toBe(false);
    expect(result.result.trim()).toBe("hello");
  });

  test("Bash: returns isError for non-zero exit", async () => {
    const result = await executeTool("Bash", { command: "exit 1" }, CWD);
    expect(result.isError).toBe(true);
    expect(result.result).toContain("Exit code 1");
  });

  test("Bash: captures stderr", async () => {
    const result = await executeTool(
      "Bash",
      { command: "echo err >&2" },
      CWD
    );
    // echo to stderr with exit 0 is not an error
    expect(result.isError).toBe(false);
    expect(result.result).toContain("err");
  });

  test("Bash: returns error for empty command", async () => {
    const result = await executeTool("Bash", {}, CWD);
    expect(result.isError).toBe(true);
    expect(result.result).toContain("No command");
  });

  // ── Read ──────────────────────────────────────────────────────

  test("Read: reads this test file", async () => {
    const result = await executeTool(
      "Read",
      { file_path: import.meta.path },
      CWD
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("executeTool");
  });

  test("Read: supports offset and limit", async () => {
    const result = await executeTool(
      "Read",
      { file_path: import.meta.path, offset: 1, limit: 3 },
      CWD
    );
    expect(result.isError).toBe(false);
    const lines = result.result.split("\n");
    expect(lines.length).toBe(3);
  });

  test("Read: returns error for missing file", async () => {
    const result = await executeTool(
      "Read",
      { file_path: "/tmp/nonexistent-dough-test-file.xyz" },
      CWD
    );
    expect(result.isError).toBe(true);
  });

  // ── Write ─────────────────────────────────────────────────────

  test("Write: creates a file and reads it back", async () => {
    const tmpPath = `/tmp/dough-test-write-${Date.now()}.txt`;
    const writeResult = await executeTool(
      "Write",
      { file_path: tmpPath, content: "hello world" },
      CWD
    );
    expect(writeResult.isError).toBe(false);

    const readResult = await executeTool(
      "Read",
      { file_path: tmpPath },
      CWD
    );
    expect(readResult.isError).toBe(false);
    expect(readResult.result).toContain("hello world");

    // cleanup
    await Bun.$`rm ${tmpPath}`.quiet();
  });

  // ── Edit ──────────────────────────────────────────────────────

  test("Edit: replaces unique string", async () => {
    const tmpPath = `/tmp/dough-test-edit-${Date.now()}.txt`;
    await Bun.write(tmpPath, "alpha beta gamma");

    const result = await executeTool(
      "Edit",
      { file_path: tmpPath, old_string: "beta", new_string: "BETA" },
      CWD
    );
    expect(result.isError).toBe(false);

    const content = await Bun.file(tmpPath).text();
    expect(content).toBe("alpha BETA gamma");
    await Bun.$`rm ${tmpPath}`.quiet();
  });

  test("Edit: fails on non-unique string", async () => {
    const tmpPath = `/tmp/dough-test-edit-dup-${Date.now()}.txt`;
    await Bun.write(tmpPath, "aaa bbb aaa");

    const result = await executeTool(
      "Edit",
      { file_path: tmpPath, old_string: "aaa", new_string: "xxx" },
      CWD
    );
    expect(result.isError).toBe(true);
    expect(result.result).toContain("multiple times");
    await Bun.$`rm ${tmpPath}`.quiet();
  });

  test("Edit: fails when old_string not found", async () => {
    const tmpPath = `/tmp/dough-test-edit-missing-${Date.now()}.txt`;
    await Bun.write(tmpPath, "hello world");

    const result = await executeTool(
      "Edit",
      { file_path: tmpPath, old_string: "xyz", new_string: "abc" },
      CWD
    );
    expect(result.isError).toBe(true);
    expect(result.result).toContain("not found");
    await Bun.$`rm ${tmpPath}`.quiet();
  });

  // ── Glob ──────────────────────────────────────────────────────

  test("Glob: finds .ts files", async () => {
    const result = await executeTool(
      "Glob",
      { pattern: "*.ts" },
      import.meta.dirname!
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("executor.test.ts");
  });

  // ── Grep ──────────────────────────────────────────────────────

  test("Grep: finds pattern in files", async () => {
    const result = await executeTool(
      "Grep",
      { pattern: "executeTool", path: import.meta.path },
      CWD
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("executeTool");
  });

  test("Grep: returns no matches gracefully", async () => {
    const tmpPath = `/tmp/dough-test-grep-${Date.now()}.txt`;
    await Bun.write(tmpPath, "hello world\nfoo bar\n");
    const result = await executeTool(
      "Grep",
      { pattern: "zzzznothere", path: tmpPath },
      CWD
    );
    expect(result.isError).toBe(false);
    expect(result.result).toContain("No matches");
    await Bun.$`rm ${tmpPath}`.quiet();
  });

  // ── Unknown tool ──────────────────────────────────────────────

  test("Unknown tool returns error", async () => {
    const result = await executeTool("FooBar", {}, CWD);
    expect(result.isError).toBe(true);
    expect(result.result).toContain("Unknown tool: FooBar");
  });
});
