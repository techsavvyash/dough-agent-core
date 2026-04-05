/**
 * Local tool executor — Bun-native implementations of the canonical tools.
 *
 * Used by the Codex provider to execute tools locally after receiving
 * function_call items from the Responses API. Tool names match Claude's
 * convention (Bash, Read, Write, Edit, Glob, Grep) so all extensions
 * and middleware work identically across providers.
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";

export interface ToolExecResult {
  result: string;
  isError: boolean;
}

const DEFAULT_BASH_TIMEOUT = 120_000; // 2 minutes

/**
 * Execute a built-in tool by name.
 *
 * Returns the tool output as a string result. Unknown tools return
 * an error result — the model typically self-corrects.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecResult> {
  switch (name) {
    case "Bash":
      return executeBash(args, cwd);
    case "Read":
      return executeRead(args, cwd);
    case "Write":
      return executeWrite(args, cwd);
    case "Edit":
      return executeEdit(args, cwd);
    case "Glob":
      return executeGlob(args, cwd);
    case "Grep":
      return executeGrep(args, cwd);
    default:
      return { result: `Unknown tool: ${name}`, isError: true };
  }
}

// ── Bash ──────────────────────────────────────────────────────────

async function executeBash(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecResult> {
  const command = String(args.command ?? "");
  if (!command) {
    return { result: "No command provided", isError: true };
  }

  const timeout = typeof args.timeout === "number"
    ? args.timeout
    : DEFAULT_BASH_TIMEOUT;

  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    // Set up timeout
    const timer = setTimeout(() => proc.kill(), timeout);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    clearTimeout(timer);

    const output = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
    const isError = exitCode !== 0;

    return {
      result: isError
        ? `Exit code ${exitCode}\n${output}`.trim()
        : output || "(no output)",
      isError,
    };
  } catch (err) {
    return {
      result: `Command failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

// ── Read ──────────────────────────────────────────────────────────

async function executeRead(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecResult> {
  const filePath = resolvePath(String(args.file_path ?? ""), cwd);
  if (!filePath) {
    return { result: "No file_path provided", isError: true };
  }

  try {
    const content = await Bun.file(filePath).text();
    const lines = content.split("\n");

    const offset = typeof args.offset === "number" ? Math.max(0, args.offset - 1) : 0;
    const limit = typeof args.limit === "number" ? args.limit : lines.length;
    const slice = lines.slice(offset, offset + limit);

    // Format with line numbers like `cat -n`
    const numbered = slice
      .map((line, i) => `${String(offset + i + 1).padStart(6)}\t${line}`)
      .join("\n");

    return { result: numbered || "(empty file)", isError: false };
  } catch (err) {
    return {
      result: `Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

// ── Write ─────────────────────────────────────────────────────────

async function executeWrite(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecResult> {
  const filePath = resolvePath(String(args.file_path ?? ""), cwd);
  const content = String(args.content ?? "");
  if (!filePath) {
    return { result: "No file_path provided", isError: true };
  }

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await Bun.write(filePath, content);
    return { result: `Wrote ${content.length} bytes to ${filePath}`, isError: false };
  } catch (err) {
    return {
      result: `Failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

// ── Edit ──────────────────────────────────────────────────────────

async function executeEdit(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecResult> {
  const filePath = resolvePath(String(args.file_path ?? ""), cwd);
  const oldString = String(args.old_string ?? "");
  const newString = String(args.new_string ?? "");

  if (!filePath) {
    return { result: "No file_path provided", isError: true };
  }
  if (!oldString) {
    return { result: "No old_string provided", isError: true };
  }

  try {
    const content = await Bun.file(filePath).text();

    // old_string must appear exactly once
    const firstIdx = content.indexOf(oldString);
    if (firstIdx === -1) {
      return { result: `old_string not found in ${filePath}`, isError: true };
    }
    const secondIdx = content.indexOf(oldString, firstIdx + 1);
    if (secondIdx !== -1) {
      return {
        result: `old_string appears multiple times in ${filePath}. Provide more context to make it unique.`,
        isError: true,
      };
    }

    const updated = content.replace(oldString, newString);
    await Bun.write(filePath, updated);
    return { result: `Edited ${filePath}`, isError: false };
  } catch (err) {
    return {
      result: `Failed to edit ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

// ── Glob ──────────────────────────────────────────────────────────

async function executeGlob(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecResult> {
  const pattern = String(args.pattern ?? "");
  if (!pattern) {
    return { result: "No pattern provided", isError: true };
  }

  const searchDir = args.path ? resolvePath(String(args.path), cwd) : cwd;

  try {
    const glob = new Bun.Glob(pattern);
    const matches: string[] = [];
    for await (const path of glob.scan({ cwd: searchDir, dot: true })) {
      matches.push(path);
      if (matches.length >= 1000) break; // safety limit
    }
    return {
      result: matches.length > 0 ? matches.join("\n") : "No matches found",
      isError: false,
    };
  } catch (err) {
    return {
      result: `Glob failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

// ── Grep ──────────────────────────────────────────────────────────

async function executeGrep(
  args: Record<string, unknown>,
  cwd: string
): Promise<ToolExecResult> {
  const pattern = String(args.pattern ?? "");
  if (!pattern) {
    return { result: "No pattern provided", isError: true };
  }

  const searchPath = args.path ? resolvePath(String(args.path), cwd) : cwd;

  const rgArgs = ["rg", "--no-heading", "-n", pattern];
  if (args.glob) {
    rgArgs.push("--glob", String(args.glob));
  }
  rgArgs.push(searchPath);

  try {
    const proc = Bun.spawn(rgArgs, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    // rg exit code 1 means no matches (not an error)
    if (exitCode === 1) {
      return { result: "No matches found", isError: false };
    }
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { result: `Grep failed (exit ${exitCode}): ${stderr}`, isError: true };
    }

    // Limit output to avoid overwhelming the model
    const lines = stdout.split("\n");
    if (lines.length > 500) {
      return {
        result: lines.slice(0, 500).join("\n") + `\n... (${lines.length - 500} more lines truncated)`,
        isError: false,
      };
    }

    return { result: stdout || "No matches found", isError: false };
  } catch (err) {
    return {
      result: `Grep failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function resolvePath(path: string, cwd: string): string {
  if (!path) return "";
  return isAbsolute(path) ? path : resolve(cwd, path);
}
