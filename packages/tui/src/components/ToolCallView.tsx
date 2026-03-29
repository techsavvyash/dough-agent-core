import { useState, useEffect } from "react";
import type { ToolCallEntry } from "../hooks/useSession.ts";
import { colors, symbols } from "../theme.ts";

/** Number of output lines to show inline before truncating. */
const PREVIEW_LINES = 6;

interface ToolCallViewProps {
  toolCall: ToolCallEntry;
  /** When true, renders the dash in accent colour to indicate keyboard focus. */
  selected?: boolean;
}

/**
 * Renders a single tool call in terminal-log style:
 *
 *   ─ $ echo hello world
 *     hello world
 *
 *   ─ ✓ Read  src/App.tsx
 */
export function ToolCallView({ toolCall, selected = false }: ToolCallViewProps) {
  const { name, args, status, result, output } = toolCall;
  const accent = selected ? colors.accent : statusColor(status);

  // Animated spinner for pending tool calls
  const [spinFrame, setSpinFrame] = useState(0);
  useEffect(() => {
    if (status !== "pending") return;
    const id = setInterval(
      () => setSpinFrame((f) => (f + 1) % symbols.spinnerFrames.length),
      80,
    );
    return () => clearInterval(id);
  }, [status]);

  const isBash = name === "Bash" || name === "bash" || name === "execute";
  const bashCommand = isBash && args.command ? String(args.command) : null;
  const argSummary = bashCommand ? null : formatArgs(name, args);
  const label = formatToolName(name);

  // Output preview
  const rawOutput = typeof output === "string" ? output : undefined;
  const outputLines = rawOutput ? rawOutput.trimEnd().split("\n") : [];
  const previewText = outputLines.slice(0, PREVIEW_LINES).join("\n");
  const extraLines = Math.max(0, outputLines.length - PREVIEW_LINES);
  const showOutputPreview = isBash && outputLines.length > 0 && status !== "pending";

  return (
    <box flexDirection="column" marginLeft={2}>

      {/* ─ $ command  (bash)  OR  ─ ✓ Label  arg  (other tools) */}
      <box flexDirection="row">
        <text fg={accent}>{symbols.hrule + " "}</text>
        {isBash ? (
          <box flexDirection="row">
            {status === "pending" ? (
              <text fg={colors.warning}>
                {(symbols.spinnerFrames[spinFrame] ?? symbols.spinnerFrames[0]!) + " "}
              </text>
            ) : (
              <text fg={statusColor(status)}>{statusIcon(status) + " "}</text>
            )}
            <text fg={colors.textMuted}>{"$ "}</text>
            <text fg={colors.text}>{bashCommand ?? ""}</text>
          </box>
        ) : (
          <box flexDirection="row">
            <text fg={accent}>
              {status === "pending"
                ? (symbols.spinnerFrames[spinFrame] ?? symbols.spinnerFrames[0]!) + " "
                : statusIcon(status) + " "}
            </text>
            <text fg={colors.textDim}>{label}</text>
            {argSummary ? <text fg={colors.textMuted}>{"  " + argSummary}</text> : null}
          </box>
        )}
      </box>

      {/* Output preview — indented to align under command text */}
      {showOutputPreview && (
        <box paddingLeft={4} flexDirection="column">
          <text fg={colors.textDim} wrapMode="char">{previewText}</text>
          {extraLines > 0 && (
            <box flexDirection="row">
              <text fg={colors.textMuted}>
                {"…" + String(extraLines) + " more line" + (extraLines === 1 ? "" : "s") + "  "}
              </text>
              <text fg={colors.borderActive}>Ctrl+O</text>
            </box>
          )}
        </box>
      )}

      {/* Error output */}
      {status === "error" && result != null && !output && (
        <box paddingLeft={4}>
          <text fg={colors.error} wrapMode="word">{String(result).slice(0, 300)}</text>
        </box>
      )}

    </box>
  );
}

function statusIcon(status: ToolCallEntry["status"]): string {
  switch (status) {
    case "pending": return symbols.toolPending;
    case "success": return symbols.toolSuccess;
    case "error":   return symbols.toolError;
  }
}

function statusColor(status: ToolCallEntry["status"]): string {
  switch (status) {
    case "pending": return colors.warning;
    case "success": return colors.success;
    case "error":   return colors.error;
  }
}

function formatToolName(name: string): string {
  const labels: Record<string, string> = {
    read_file:   "Read",
    write_file:  "Write",
    create_file: "Create",
    edit_file:   "Edit",
    str_replace: "Edit",
    insert:      "Insert",
    replace:     "Replace",
    patch:       "Patch",
    bash:        "Run",
    execute:     "Run",
    search:      "Search",
    grep:        "Grep",
    glob:        "Glob",
    list_dir:    "List",
    delete_file: "Delete",
  };
  return labels[name] ?? name;
}

function formatArgs(_name: string, args: Record<string, unknown>): string {
  if (args.file_path || args.path || args.filePath) {
    const p = String(args.file_path ?? args.path ?? args.filePath);
    const parts = p.split("/").filter(Boolean);
    return parts.slice(-2).join("/") || p;
  }
  if (args.pattern || args.query) {
    const pat = String(args.pattern ?? args.query);
    return pat.length > 80 ? pat.slice(0, 77) + "…" : pat;
  }
  return "";
}
