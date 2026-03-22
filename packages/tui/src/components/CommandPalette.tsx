import { useState, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { colors, symbols, hrule } from "../theme.ts";

export interface Command {
  name: string;
  description: string;
  value: string;
}

interface CommandPaletteProps {
  commands: Command[];
  onSelect: (command: string) => void;
  onClose: () => void;
}

const MAX_VISIBLE = 5;

export function CommandPalette({
  commands,
  onSelect,
  onClose,
}: CommandPaletteProps) {
  const { width, height: termHeight } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [query, setQuery] = useState("");

  // Filter commands based on search query
  const filtered = query === ""
    ? commands
    : commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(query.toLowerCase()) ||
          cmd.description.toLowerCase().includes(query.toLowerCase())
      );

  // Reset selection whenever the filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (query.length > 0) {
        setQuery("");
      } else {
        onClose();
      }
    } else if (key.name === "up") {
      setSelectedIndex((i: number) => (i > 0 ? i - 1 : Math.max(0, filtered.length - 1)));
    } else if (key.name === "down") {
      setSelectedIndex((i: number) =>
        filtered.length === 0 ? 0 : i < filtered.length - 1 ? i + 1 : 0
      );
    } else if (key.name === "return") {
      const cmd = filtered[selectedIndex];
      if (cmd) onSelect(cmd.value);
    } else if (key.name === "backspace") {
      setQuery((q: string) => q.slice(0, -1));
    } else if (
      key.sequence &&
      key.sequence.length === 1 &&
      !key.ctrl &&
      !key.meta &&
      // Only accept printable ASCII (space through ~); excludes ESC (\x1b),
      // DEL, and other control characters that the terminal parser may emit as
      // intermediate events before resolving the final key name (e.g. on Linux
      // the parser emits \x1b with no key.name before emitting key.name=escape).
      key.sequence.charCodeAt(0) >= 32 &&
      key.sequence.charCodeAt(0) <= 126
    ) {
      // Accumulate printable characters into the search query
      setQuery((q: string) => q + key.sequence);
    }
  });

  const rule = hrule(width);
  const searchPrompt = `  ${symbols.userPrefix} ${query}${symbols.cursor}`;

  // Cap visible commands so palette never overflows
  // Palette chrome: separator(1) + search(1) + separator(1) + hint(1) + separator(1) = 5
  // Use at most half the terminal height for the palette
  const maxPaletteRows = Math.max(6, Math.floor(termHeight / 2));
  const maxItems = Math.min(MAX_VISIBLE, filtered.length, maxPaletteRows - 5);

  // Window the visible list around the selected index
  let startIdx = 0;
  if (filtered.length > maxItems) {
    startIdx = Math.max(0, Math.min(selectedIndex - Math.floor(maxItems / 2), filtered.length - maxItems));
  }
  const visibleItems = filtered.slice(startIdx, startIdx + maxItems);
  const hasMore = filtered.length > maxItems;

  // Fixed height: separator(1) + search(1) + separator(1) + items + hint(1) + separator(1)
  const paletteHeight = Math.min(maxItems, visibleItems.length || 1) + 5;

  return (
    <box flexDirection="column" height={paletteHeight}>
      <box height={1}>
        <text fg={colors.borderActive}>{rule}</text>
      </box>

      {/* Search bar */}
      <box height={1} paddingX={1}>
        <text fg={colors.accent}>
          {searchPrompt}
          {query === "" ? "  type to filter…" : ""}
        </text>
      </box>

      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>

      {/* Command list — windowed */}
      <box flexDirection="column">
        {filtered.length === 0 ? (
          <box height={1} paddingX={2}>
            <text fg={colors.textMuted}>{"no matching commands"}</text>
          </box>
        ) : (
          visibleItems.map((cmd, vi) => {
            const realIdx = startIdx + vi;
            const isSelected = realIdx === selectedIndex;
            const indicator = isSelected ? `${symbols.userPrefix} ` : "  ";
            const suffix = isSelected && hasMore ? ` (${realIdx + 1}/${filtered.length})` : "";
            const label = `${indicator}${cmd.name}  ${cmd.description}${suffix}`;
            const textColor = isSelected ? colors.primary : colors.text;
            return (
              <box key={cmd.value} height={1}>
                <text fg={textColor}>{label}</text>
              </box>
            );
          })
        )}
      </box>

      {/* Footer hint */}
      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>{"↑↓ navigate  ·  Enter select  ·  Esc close"}</text>
      </box>

      <box height={1}>
        <text fg={colors.borderActive}>{rule}</text>
      </box>
    </box>
  );
}

export const COMMANDS: Command[] = [
  {
    name: "/thread info",
    description: "Show current thread details",
    value: "thread_info",
  },
  {
    name: "/thread list",
    description: "View thread tree (Ctrl+T)",
    value: "thread_list",
  },
  {
    name: "/thread fork",
    description: "Fork current thread into a new branch",
    value: "thread_fork",
  },
  {
    name: "/thread new",
    description: "Start a fresh thread (old threads preserved)",
    value: "thread_new",
  },
  {
    name: "/clear",
    description: "Clear the chat display",
    value: "clear",
  },
  {
    name: "/compact",
    description: "Summarize and handoff to fresh thread",
    value: "compact",
  },
  {
    name: "/exit",
    description: "Exit Dough",
    value: "exit",
  },
];
