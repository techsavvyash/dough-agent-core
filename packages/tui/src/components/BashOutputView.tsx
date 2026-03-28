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

type FocusedPanel = "sidebar" | "output";

const SIDEBAR_W_MAX = 38;
const SIDEBAR_W_FRAC = 0.28;

/**
 * Full-screen bash output viewer — mirrors DiffView's chrome and layout.
 *
 * Left sidebar: list of every bash command run this session.
 * Right panel:  full scrollable stdout/stderr for the selected command.
 *
 * Keyboard:
 *   ← / h        — focus sidebar
 *   → / l        — focus output panel
 *   ↑ / k        — previous command (sidebar focused)
 *   ↓ / j        — next command    (sidebar focused)
 *                  output panel scrolls natively when focused
 *   b            — toggle sidebar
 *   Ctrl+O / Esc — close
 */
export function BashOutputView({ calls, onClose }: BashOutputViewProps) {
  const { width, height } = useTerminalDimensions();
  // Default to the last (most recent) call
  const [selectedIndex, setSelectedIndex] = useState(
    calls.length > 0 ? calls.length - 1 : 0
  );
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("sidebar");
  const [sidebarScrollTop, setSidebarScrollTop] = useState(
    // Start scrolled to the last item
    Math.max(0, calls.length - 1)
  );

  // Header rule+stat+rule = 3, footer rule = 1, sidebar index indicator = 1
  const SIDEBAR_CHROME = 5;
  const sidebarViewport = Math.max(1, height - SIDEBAR_CHROME);

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "o")) {
      onClose();
    } else if (key.name === "left" || key.name === "h") {
      setSidebarVisible(true);
      setFocusedPanel("sidebar");
    } else if (key.name === "right" || key.name === "l") {
      setFocusedPanel("output");
    } else if (focusedPanel === "sidebar") {
      // j/k/↑/↓ navigate commands when sidebar owns focus.
      // When output is focused, <scrollbox focused> scrolls natively.
      if (key.name === "up" || key.name === "k") {
        setSelectedIndex((i) => {
          const next = i > 0 ? i - 1 : calls.length - 1;
          setSidebarScrollTop((st) => adjustScrollFlat(next, st, sidebarViewport));
          return next;
        });
      } else if (key.name === "down" || key.name === "j") {
        setSelectedIndex((i) => {
          const next = i < calls.length - 1 ? i + 1 : 0;
          setSidebarScrollTop((st) => adjustScrollFlat(next, st, sidebarViewport));
          return next;
        });
      } else if (key.name === "b") {
        setSidebarVisible((v) => !v);
        if (sidebarVisible) setFocusedPanel("output");
      }
    } else {
      // output panel focused — still allow sidebar toggle
      if (key.name === "b") {
        setSidebarVisible((v) => !v);
      }
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
        <text fg={colors.accent}>{String(calls.length) + " command" + (calls.length === 1 ? "" : "s") + "  "}</text>
        {sel && (
          <text fg={statusColor(sel.status)}>
            {statusIcon(sel.status)}{"  "}
          </text>
        )}
        <text fg={colors.textMuted}>
          {"←→/h/l focus panel · ↑↓/j/k "}
          {focusedPanel === "sidebar" ? "navigate" : "scroll output"}
          {" · b "}
          {sidebarVisible ? "hide" : "show"}
          {" sidebar · Esc close"}
        </text>
      </box>
      <box height={1}><text fg={colors.border}>{rule}</text></box>

      {/* ── Body ── */}
      <box flex={1} flexDirection="row">

        {/* Sidebar: command list */}
        {sidebarVisible && (
          <box
            width={sidebarW}
            flexDirection="column"
            border={["right"]}
            borderFg={focusedPanel === "sidebar" ? colors.accent : colors.border}
          >
            <scrollbox flex={1} scrollTop={sidebarScrollTop}>
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
                {String(selectedIndex + 1) + "/" + String(calls.length)}
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
              <text fg={focusedPanel === "output" ? colors.text : colors.textDim}>
                {sel.command}
              </text>
              {focusedPanel === "output" && (
                <text fg={colors.accent}>{"  ●"}</text>
              )}
            </box>
          )}
          <box height={1}><text fg={colors.border}>{hrule(width)}</text></box>

          {/* Scrollable output — focused lets it handle j/k/↑/↓ natively */}
          {/* key resets scroll position whenever the selected command changes */}
          <scrollbox
            flex={1}
            paddingX={2}
            focused={focusedPanel === "output"}
            key={sel?.callId}
          >
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

/**
 * Return a scrollTop that keeps a flat list item (all items height=1) visible.
 * Scrolls minimally — only moves if the item falls outside the viewport.
 */
function adjustScrollFlat(index: number, scrollTop: number, viewportHeight: number): number {
  if (index < scrollTop) return index;
  if (index >= scrollTop + viewportHeight) return index - viewportHeight + 1;
  return scrollTop;
}

/** Truncate a command to fit within maxLen, preserving the start. */
function truncateCommand(cmd: string, maxLen: number): string {
  // Use only the first line (multi-line commands)
  const firstLine = cmd.split("\n")[0] ?? cmd;
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 1) + "…";
}
