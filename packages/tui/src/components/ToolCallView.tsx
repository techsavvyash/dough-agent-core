import { useState, useEffect } from "react";
import type { ToolCallEntry } from "../hooks/useSession.ts";
import { colors, symbols } from "../theme.ts";

interface ToolCallViewProps {
  toolCall: ToolCallEntry;
  selected?: boolean;
}

/**
 * Renders a single tool call inside ToolCallGroup.
 *
 *   ✓  $  git status                   · 0.3s
 *      main
 *
 *   ✓  Read   src/App.tsx
 *
 *   ⠙  Write  src/output.ts
 *
 *   ⠙  Agent  code-reviewer    [Ctrl+G]
 *      └ ✓ Read   src/
 *      └ ⠙ Bash   tsc --noEmit
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

  const spinnerChar =
    symbols.spinnerFrames[spinFrame] ?? symbols.spinnerFrames[0]!;
  const icon = status === "pending" ? spinnerChar : statusIcon(status);

  const isBash = name === "Bash" || name === "bash" || name === "execute";
  const isAgent = name === "Agent" || name === "agent";
  const bashCommand = isBash && args.command ? String(args.command) : null;
  const argSummary = isBash || isAgent ? null : formatArgs(name, args);
  const label = formatToolName(name);

  // Full output for bash/agent tools
  const rawOutput = typeof output === "string" ? output : undefined;
  const outputText = rawOutput ? rawOutput.trimEnd() : "";
  const showOutputPreview =
    (isBash || isAgent) && outputText.length > 0 && status !== "pending";

  // Sub-steps from agent tool (parsed from output if JSON-like or plain lines)
  const agentSubSteps = isAgent && args.subSteps
    ? (args.subSteps as string[])
    : null;

  return (
    <box flexDirection="column" paddingX={1} paddingY={0}>

      {/* ── Header row ─────────────────────────────────────── */}
      <box flexDirection="row" height={1}>
        {/* Status icon */}
        <box width={3} flexShrink={0}>
          <text fg={accent}>{icon + " "}</text>
        </box>

        {isBash ? (
          /* Bash: icon · $ · command */
          <box flexDirection="row">
            <text fg={colors.textMuted}>{"$  "}</text>
            <text fg={colors.text}>{bashCommand ?? ""}</text>
          </box>
        ) : isAgent ? (
          /* Agent: icon · "Agent" · description hint */
          <box flexDirection="row">
            <text fg={colors.secondary}>{"Agent  "}</text>
            <text fg={colors.textMuted}>
              {String(args.description ?? args.subagent_type ?? "sub-agent")}
            </text>
            {status === "pending" && (
              <text fg={colors.borderActive}>{"  [Ctrl+G view]"}</text>
            )}
          </box>
        ) : (
          /* Other tool: icon · label · arg */
          <box flexDirection="row">
            <text fg={colors.textDim}>{label + "  "}</text>
            {argSummary ? (
              <text fg={colors.textMuted}>{argSummary}</text>
            ) : null}
          </box>
        )}
      </box>

      {/* ── Output / sub-steps preview ──────────────────────── */}
      {showOutputPreview && (
        <box paddingLeft={3} flexDirection="column">
          {isAgent && agentSubSteps ? (
            /* Agent sub-steps */
            agentSubSteps.map((step, i) => (
              <box key={i} height={1} flexDirection="row">
                <text fg={colors.textMuted}>{"└ "}</text>
                <text fg={colors.textDim}>{step}</text>
              </box>
            ))
          ) : (
            /* Full output — no truncation */
            <text fg={colors.textDim} wrapMode="char">{outputText}</text>
          )}
          {isBash && (
            <box flexDirection="row" height={1}>
              <text fg={colors.borderActive}>{"Ctrl+O"}</text>
              <text fg={colors.textMuted}>{"  all commands"}</text>
            </box>
          )}
        </box>
      )}

      {/* ── Pending agent sub-steps (from args if available) ── */}
      {isAgent && status === "pending" && agentSubSteps && (
        <box paddingLeft={3} flexDirection="column">
          {agentSubSteps.map((step, i) => (
            <box key={i} height={1} flexDirection="row">
              <text fg={colors.textMuted}>{"└ "}</text>
              <text fg={colors.textDim}>{step}</text>
            </box>
          ))}
        </box>
      )}

      {/* ── Error output ────────────────────────────────────── */}
      {status === "error" && result != null && !output && (
        <box paddingLeft={3}>
          <text fg={colors.error} wrapMode="word">
            {String(result).slice(0, 300)}
          </text>
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
    read_file:    "Read",
    write_file:   "Write",
    create_file:  "Create",
    edit_file:    "Edit",
    str_replace:  "Edit",
    insert:       "Insert",
    replace:      "Replace",
    patch:        "Patch",
    bash:         "Run",
    execute:      "Run",
    search:       "Search",
    grep:         "Grep",
    glob:         "Glob",
    list_dir:     "List",
    delete_file:  "Delete",
    Read:         "Read",
    Write:        "Write",
    Edit:         "Edit",
    Bash:         "Run",
    Glob:         "Glob",
    Grep:         "Grep",
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
    return pat.length > 60 ? pat.slice(0, 57) + "…" : pat;
  }
  return "";
}
