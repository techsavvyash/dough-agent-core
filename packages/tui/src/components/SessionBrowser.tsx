import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { SessionMeta } from "@dough/protocol";
import { colors, hrule } from "../theme.ts";

interface SessionBrowserProps {
  sessions: SessionMeta[];
  activeSessionId: string;
  onClose: () => void;
  onSwitch: (session: SessionMeta) => void;
}

const SIDEBAR_W = 36;

export function SessionBrowser({
  sessions,
  activeSessionId,
  onClose,
  onSwitch,
}: SessionBrowserProps) {
  const { width } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(
    Math.max(0, sessions.findIndex((s) => s.id === activeSessionId))
  );

  const isNarrow = width < 80;

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "s")) {
      onClose();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((i) => Math.min(sessions.length - 1, i + 1));
      return;
    }
    if (key.name === "return") {
      const sel = sessions[selectedIndex];
      if (sel && sel.id !== activeSessionId) onSwitch(sel);
      else onClose();
      return;
    }
  });

  const selected = sessions[selectedIndex];
  const rule = hrule(width);

  return (
    <box flexDirection="column" height="100%">
      {/* Header */}
      <box height={1}>
        <text fg={colors.primary}>{rule}</text>
      </box>
      <box height={1} paddingX={1} flexDirection="row">
        <text fg={colors.accent}>{"Sessions  "}</text>
        <text fg={colors.textMuted}>
          {String(sessions.length) +
            " total  \u00b7  j/k navigate  \u00b7  Enter switch  \u00b7  Esc close"}
        </text>
      </box>
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>

      {/* Content */}
      <box flex={1} flexDirection="row">
        {/* Sidebar — only on wide terminals */}
        {!isNarrow && (
          <box
            width={SIDEBAR_W}
            flexDirection="column"
            borderColor={colors.border}
            border={["right"]}
            borderStyle="single"
          >
            <scrollbox flex={1}>
              {sessions.map((s, i) => {
                const isActive = s.id === activeSessionId;
                const isSelected = i === selectedIndex;
                const label = s.id.slice(0, 8);
                const date = new Date(s.createdAt).toLocaleDateString();
                return (
                  <box key={s.id} height={2} paddingX={1} flexDirection="column">
                    <box height={1} flexDirection="row">
                      <text
                        fg={
                          isSelected
                            ? colors.accent
                            : isActive
                              ? colors.primary
                              : colors.textDim
                        }
                      >
                        {isSelected ? "\u25b6 " : "  "}
                      </text>
                      <text fg={isSelected ? colors.text : colors.textDim}>{label}</text>
                      {isActive && <text fg={colors.success}>{" \u25cf"}</text>}
                    </box>
                    <box height={1} paddingLeft={4}>
                      <text fg={colors.textMuted}>{s.provider + " \u00b7 " + date}</text>
                    </box>
                  </box>
                );
              })}
              {sessions.length === 0 && (
                <box paddingX={2} paddingY={1}>
                  <text fg={colors.textMuted}>{"No sessions found."}</text>
                </box>
              )}
            </scrollbox>
          </box>
        )}

        {/* Detail panel */}
        <box flex={1} flexDirection="column" paddingX={2} paddingY={1}>
          {selected ? (
            <box flexDirection="column" gap={1}>
              <box height={1} flexDirection="row">
                <text fg={colors.textMuted}>{"id:       "}</text>
                <text fg={colors.accent}>{selected.id}</text>
              </box>
              <box height={1} flexDirection="row">
                <text fg={colors.textMuted}>{"provider: "}</text>
                <text fg={colors.text}>{selected.provider}</text>
              </box>
              {selected.model && (
                <box height={1} flexDirection="row">
                  <text fg={colors.textMuted}>{"model:    "}</text>
                  <text fg={colors.text}>{selected.model}</text>
                </box>
              )}
              <box height={1} flexDirection="row">
                <text fg={colors.textMuted}>{"created:  "}</text>
                <text fg={colors.textDim}>
                  {new Date(selected.createdAt).toLocaleString()}
                </text>
              </box>
              <box height={1} flexDirection="row">
                <text fg={colors.textMuted}>{"threads:  "}</text>
                <text fg={colors.textDim}>{String(selected.threads.length)}</text>
              </box>
              <box height={1} flexDirection="row">
                <text fg={colors.textMuted}>{"thread:   "}</text>
                <text fg={colors.textDim}>
                  {selected.activeThreadId?.slice(0, 16) ?? "none"}
                </text>
              </box>
              {selected.id === activeSessionId && (
                <box height={1} marginTop={1}>
                  <text fg={colors.success}>{"\u25cf current session"}</text>
                </box>
              )}
            </box>
          ) : (
            <text fg={colors.textMuted}>{"Select a session"}</text>
          )}
        </box>
      </box>

      {/* Footer */}
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>
    </box>
  );
}
