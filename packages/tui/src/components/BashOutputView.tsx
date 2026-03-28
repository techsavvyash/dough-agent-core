import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { colors, hrule, symbols } from "../theme.ts";

export interface BashCallEntry {
  callId: string;
  command: string;
  output?: string;
  status: "pending" | "success" | "error";
}

interface BashOutputViewProps {
  calls: BashCallEntry[];
  onClose: () => void;
}

const SIDEBAR_W_MAX = 38;
const SIDEBAR_W_FRAC = 0.28;

/**
 * Full-screen bash output viewer — mirrors DiffView's chrome and layout.
 *
 * Left sidebar: list of every bash command run this session.
 * Right panel:  full scrollable stdout/stderr for the selected command.
 *
 * Keyboard:
 *   ↑ / k      — previous command
 *   ↓ / j      — next command
 *   b          — toggle sidebar
 *   Ctrl+O / Esc — close
 */
export function BashOutputView({ calls, onClose }: BashOutputViewProps) {
  const { width } = useTerminalDimensions();
  // Default to the last (most recent) call
  const [selectedIndex, setSelectedIndex] = useState(
    calls.length > 0 ? calls.length - 1 : 0
  );
  const [sidebarVisible, setSidebarVisible] = useState(true);

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "o")) {
      onClose();
    } else if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => (i > 0 ? i - 1 : calls.length - 1));
    } else if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => (i < calls.length - 1 ? i + 1 : 0));
    } else if (key.name === "b") {
      setSidebarVisible((v) => !v);
    }
  });

  const rule = hrule(width);
  const sidebarW = Math.min(SIDEBAR_W_MAX, Math.floor(width * SIDEBAR_W_FRAC));
  const sel = calls[selectedIndex];

  if (calls.length === 0) {
    return (
      <box flexDirection="column" height="100%">
        <box height={1}><text fg={colors.border}>{rule}</text></box>
        <box paddingX={2} flex={1} justifyContent="center" alignItems="center">
          <text fg={colors.textMuted}>No bash commands have run yet.</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.textMuted}>Esc  close</text>
        </box>
        <box height={1}><text fg={colors.border}>{rule}</text></box>
      </box>
    );
  }

  const statusIcon = (status: BashCallEntry["status"]) => {
    switch (status) {
      case "pending": return symbols.toolPending;
      case "success": return symbols.toolSuccess;
      case "error":   return symbols.toolError;
    }
  };

  const statusColor = (status: BashCallEntry["status"]) => {
    switch (status) {
      case "pending": return colors.warning;
      case "success": return colors.success;
      case "error":   return colors.error;
    }
  };

  return (
    <box flexDirection="column" height="100%">

      {/* ── Header ── */}
      <box height={1}><text fg={colors.border}>{rule}</text></box>
      <box height={1} paddingX={2} flexDirection="row">
        <text fg={colors.primary}>{"Bash Output  "}</text>
        <text fg={colors.accent}>{calls.length} command{calls.length === 1 ? "" : "s"}{"  "}</text>
        {sel && (
          <text fg={statusColor(sel.status)}>
            {statusIcon(sel.status)}{"  "}
          </text>
        )}
        <text fg={colors.textMuted}>
          {"↑↓ navigate · b "}
          {sidebarVisible ? "hide" : "show"}
          {" sidebar · Esc close"}
        </text>
      </box>
      <box height={1}><text fg={colors.border}>{rule}</text></box>

      {/* ── Body ── */}
      <box flex={1} flexDirection="row">

        {/* Sidebar: command list */}
        {sidebarVisible && (
          <box width={sidebarW} flexDirection="column" border={["right"]} borderColor={colors.border}>
            <scrollbox flex={1}>
              {calls.map((call, i) => {
                const isSel = i === selectedIndex;
                const shortCmd = truncateCommand(call.command, sidebarW - 6);
                return (
                  <box key={call.callId} height={1} paddingX={1} flexDirection="row">
                    <text fg={isSel ? colors.accent : colors.textMuted}>
                      {isSel ? "▶ " : "  "}
                    </text>
                    <text fg={statusColor(call.status)}>
                      {statusIcon(call.status)}{" "}
                    </text>
                    <text fg={isSel ? colors.text : colors.textDim}>
                      {shortCmd}
                    </text>
                  </box>
                );
              })}
            </scrollbox>
            {/* Index indicator */}
            <box height={1} paddingX={1}>
              <text fg={colors.textMuted}>
                {selectedIndex + 1}/{calls.length}
              </text>
            </box>
          </box>
        )}

        {/* Main panel: full output */}
        <box flex={1} flexDirection="column">
          {/* Command header */}
          {sel && (
            <box height={1} paddingX={2} flexDirection="row">
              <text fg={statusColor(sel.status)}>{statusIcon(sel.status)}  </text>
              <text fg={colors.accent}>$ </text>
              <text fg={colors.text}>{sel.command}</text>
            </box>
          )}
          <box height={1}><text fg={colors.border}>{hrule(width)}</text></box>

          {/* Scrollable output */}
          <scrollbox flex={1} paddingX={2}>
            {sel ? (
              sel.output ? (
                <text fg={colors.text} wrapMode="char">{sel.output}</text>
              ) : sel.status === "pending" ? (
                <text fg={colors.warning}>{symbols.toolPending}  running…</text>
              ) : (
                <text fg={colors.textMuted}>(no output)</text>
              )
            ) : null}
          </scrollbox>
        </box>

      </box>

      {/* ── Footer ── */}
      <box height={1}><text fg={colors.border}>{rule}</text></box>
    </box>
  );
}

/** Truncate a command to fit within maxLen, preserving the start. */
function truncateCommand(cmd: string, maxLen: number): string {
  // Use only the first line (multi-line commands)
  const firstLine = cmd.split("\n")[0] ?? cmd;
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 1) + "…";
}
