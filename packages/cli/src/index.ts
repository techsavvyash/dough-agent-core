#!/usr/bin/env bun

import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";

// ── Constants ────────────────────────────────────────────────────────────────

const DOUGH_DIR = join(process.env.HOME ?? ".", ".dough");
const PID_FILE = join(DOUGH_DIR, "server.pid");
const LOG_FILE = join(DOUGH_DIR, "server.log");
const DEFAULT_PORT = 4200;

// Resolve the monorepo root from this file's location (packages/cli/src/index.ts → ../../..)
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const SERVER_ENTRY = resolve(REPO_ROOT, "packages/server/src/index.ts");
const TUI_ENTRY = resolve(REPO_ROOT, "packages/tui/src/index.tsx");

// ── Helpers ──────────────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  await mkdir(DOUGH_DIR, { recursive: true });
}

function getPort(): number {
  // --port flag takes priority, then DOUGH_PORT env, then default
  const idx = process.argv.indexOf("--port");
  if (idx !== -1 && process.argv[idx + 1]) {
    return parseInt(process.argv[idx + 1]!, 10);
  }
  return parseInt(process.env.DOUGH_PORT ?? String(DEFAULT_PORT), 10);
}

interface ServerStatus {
  running: boolean;
  pid?: number;
  cwd?: string;
  provider?: string;
}

async function isServerRunning(port: number): Promise<ServerStatus> {
  // Check PID file
  const pidFile = Bun.file(PID_FILE);
  if (!(await pidFile.exists())) {
    return { running: false };
  }

  const pidStr = (await pidFile.text()).trim();
  const pid = parseInt(pidStr, 10);
  if (isNaN(pid)) {
    return { running: false };
  }

  // Check if process is alive
  try {
    process.kill(pid, 0);
  } catch {
    // Process is dead, stale PID file
    await Bun.write(PID_FILE, "");
    return { running: false };
  }

  // Process is alive — confirm via health check
  try {
    const resp = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        running: true,
        pid,
        cwd: data.cwd as string | undefined,
        provider: data.provider as string | undefined,
      };
    }
  } catch {
    // Health check failed — port might be used by something else
  }

  return { running: false, pid };
}

async function waitForHealthy(port: number, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (resp.ok) return true;
    } catch {
      // Not ready yet
    }
    await Bun.sleep(250);
  }
  return false;
}

async function startDaemon(port: number): Promise<number> {
  await ensureDir();

  const proc = Bun.spawn({
    cmd: ["bun", "run", SERVER_ENTRY],
    env: {
      ...process.env,
      DOUGH_PORT: String(port),
    },
    cwd: process.cwd(),
    stdout: Bun.file(LOG_FILE),
    stderr: Bun.file(LOG_FILE),
    stdin: "ignore",
  });

  // Unref so the CLI can exit without waiting for the daemon
  proc.unref();

  await Bun.write(PID_FILE, String(proc.pid));
  return proc.pid;
}

async function stopDaemon(): Promise<boolean> {
  const pidFile = Bun.file(PID_FILE);
  if (!(await pidFile.exists())) return false;

  const pid = parseInt((await pidFile.text()).trim(), 10);
  if (isNaN(pid)) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already dead
  }

  // Wait briefly for graceful exit
  for (let i = 0; i < 10; i++) {
    await Bun.sleep(200);
    try {
      process.kill(pid, 0);
    } catch {
      // Dead — clean up
      await Bun.write(PID_FILE, "");
      return true;
    }
  }

  // Force kill
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already dead
  }
  await Bun.write(PID_FILE, "");
  return true;
}

// ── Colors (minimal ANSI) ────────────────────────────────────────────────────

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdDefault(): Promise<void> {
  const port = getPort();
  await ensureDir();

  let status = await isServerRunning(port);

  if (!status.running) {
    process.stdout.write(c.dim("Starting server daemon..."));
    const pid = await startDaemon(port);
    const healthy = await waitForHealthy(port);
    if (!healthy) {
      console.log(c.red(" failed"));
      console.log(`Check logs: ${c.dim(LOG_FILE)}`);
      process.exit(1);
    }
    console.log(c.green(` ready`) + c.dim(` (pid ${pid}, port ${port})`));
    status = await isServerRunning(port);
  } else {
    // Check cwd mismatch
    if (status.cwd && status.cwd !== process.cwd()) {
      console.log(
        c.yellow("⚠ Server is running in a different directory:\n") +
        c.dim(`  server: ${status.cwd}\n`) +
        c.dim(`  current: ${process.cwd()}\n`) +
        c.yellow("  Run `dough server restart` to switch.\n")
      );
    }
  }

  // Launch TUI in the foreground
  const tui = Bun.spawn({
    cmd: [
      "bun", "run", TUI_ENTRY,
      "--port", String(port),
      "--server", `ws://localhost:${port}/ws`,
    ],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    cwd: process.cwd(),
  });

  const exitCode = await tui.exited;
  process.exit(exitCode);
}

async function cmdServerStart(): Promise<void> {
  const port = getPort();
  const status = await isServerRunning(port);

  if (status.running) {
    console.log(c.green("●") + ` Server already running ${c.dim(`(pid ${status.pid}, port ${port})`)}`);
    return;
  }

  process.stdout.write(c.dim("Starting server..."));
  const pid = await startDaemon(port);
  const healthy = await waitForHealthy(port);

  if (healthy) {
    console.log(c.green(` ready`) + c.dim(` (pid ${pid}, port ${port})`));
  } else {
    console.log(c.red(" failed"));
    console.log(`Check logs: ${c.dim(LOG_FILE)}`);
    process.exit(1);
  }
}

async function cmdServerStop(): Promise<void> {
  const stopped = await stopDaemon();
  if (stopped) {
    console.log(c.green("●") + " Server stopped");
  } else {
    console.log(c.dim("No server running"));
  }
}

async function cmdServerRestart(): Promise<void> {
  await cmdServerStop();
  await cmdServerStart();
}

async function cmdServerStatus(): Promise<void> {
  const port = getPort();
  const status = await isServerRunning(port);

  if (status.running) {
    console.log(c.green("●") + c.bold(" Server running"));
    console.log(c.dim(`  PID:      ${status.pid}`));
    console.log(c.dim(`  Port:     ${port}`));
    if (status.provider) console.log(c.dim(`  Provider: ${status.provider}`));
    if (status.cwd) console.log(c.dim(`  CWD:      ${status.cwd}`));
  } else {
    console.log(c.red("●") + c.bold(" Server not running"));
  }
}

async function cmdServerLogs(): Promise<void> {
  const file = Bun.file(LOG_FILE);
  if (!(await file.exists())) {
    console.log(c.dim("No log file yet"));
    return;
  }

  const tail = Bun.spawn({
    cmd: ["tail", "-f", "-n", "50", LOG_FILE],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await tail.exited;
}

function printHelp(): void {
  console.log(`
${c.bold("dough")} — AI Agent Platform CLI

${c.bold("Usage:")}
  dough                   Launch TUI (starts server if needed)
  dough server start      Start server daemon
  dough server stop       Stop server daemon
  dough server restart    Restart server daemon
  dough server status     Check server status
  dough server logs       Tail server logs

${c.bold("Options:")}
  --port <n>              Server port (default: 4200, or DOUGH_PORT env)
  --help                  Show this help
`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--port" && !a.match(/^\d+$/));

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const cmd = args[0];
  const sub = args[1];

  if (!cmd) {
    await cmdDefault();
    return;
  }

  if (cmd === "server") {
    switch (sub) {
      case "start":
        await cmdServerStart();
        return;
      case "stop":
        await cmdServerStop();
        return;
      case "restart":
        await cmdServerRestart();
        return;
      case "status":
        await cmdServerStatus();
        return;
      case "logs":
        await cmdServerLogs();
        return;
      default:
        console.log(c.red(`Unknown server command: ${sub ?? "(none)"}`));
        printHelp();
        process.exit(1);
    }
  }

  console.log(c.red(`Unknown command: ${cmd}`));
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
