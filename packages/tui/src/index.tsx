import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App.tsx";

/**
 * Read terminal dimensions from /dev/tty via `stty size`.
 *
 * When launched via `bun run --filter`, Bun wraps the child process's stdout
 * in an internal pipe so process.stdout.rows/columns are undefined.  OpenTUI's
 * createCliRenderer defaults to 80×24 in that case.  We query the controlling
 * terminal directly using `stty size` (reads from /dev/tty so it works even
 * when stdout is a pipe).
 */
function readSttyDimensions(): { rows: number; columns: number } {
  try {
    // stty reads terminal dimensions from /dev/tty, not stdin/stdout
    const result = Bun.spawnSync(["stty", "size"], {
      stdin: Bun.file("/dev/tty"),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      const parts = result.stdout.toString().trim().split(" ");
      const r = parseInt(parts[0] ?? "", 10);
      const c = parseInt(parts[1] ?? "", 10);
      if (r > 0 && c > 0) return { rows: r, columns: c };
    }
  } catch {
    // stty not available (Windows, etc.) — fall through to env/defaults
  }
  return {
    rows:
      process.stdout.rows ||
      process.stderr.rows ||
      (process.env.LINES ? parseInt(process.env.LINES, 10) : 0) ||
      40,
    columns:
      process.stdout.columns ||
      process.stderr.columns ||
      (process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : 0) ||
      80,
  };
}

/**
 * Patch process.stdout with correct terminal dimensions so OpenTUI's
 * createCliRenderer uses the real terminal size rather than the 80×24 default.
 */
function patchStdoutDimensions(): void {
  const { rows, columns } = readSttyDimensions();
  // Always override with stty values — process.stdout may carry a stale or
  // off-by-one value from the parent shell (e.g., tmux reports rows - 1 when
  // its status bar is visible, or Bun pipes may report any cached value).
  // Using stty ensures we read directly from the controlling TTY.
  try {
    Object.defineProperty(process.stdout, "columns", {
      get: () => columns,
      configurable: true,
    });
  } catch { /* already non-configurable — fall through */ }
  try {
    Object.defineProperty(process.stdout, "rows", {
      get: () => rows,
      configurable: true,
    });
  } catch { /* already non-configurable — fall through */ }
}

const args = process.argv.slice(2);

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1]!;
  }
  return defaultValue;
}

const port = getArg("port", "4200");
const provider = getArg("provider", "claude");
const model = getArg("model", "");
const serverUrl = getArg("server", `ws://localhost:${port}/ws`);

async function main() {
  // Ensure OpenTUI gets the correct terminal dimensions even when stdout is
  // a Bun-internal pipe (e.g. when launched via `bun run tui`).
  patchStdoutDimensions();

  // Clear the terminal before entering OpenTUI's alternate screen to avoid
  // stale content from previous sessions bleeding through on re-render.
  // Use /dev/tty for write so this works even when stdout is piped.
  try {
    const tty = await Bun.file("/dev/tty").stream();
    void tty; // just ensure it's accessible
    // Write clear + cursor-home directly to tty fd if accessible
    Bun.spawnSync(["sh", "-c", "printf '\\033[2J\\033[H' > /dev/tty"], {
      stderr: "pipe",
    });
  } catch { /* ignore if /dev/tty not accessible */ }

  const renderer = await createCliRenderer();
  const root = createRoot(renderer);

  root.render(
    <App
      serverUrl={serverUrl}
      provider={provider}
      model={model || undefined}
    />
  );
}

main().catch((err) => {
  console.error("Failed to start TUI:", err);
  process.exit(1);
});
