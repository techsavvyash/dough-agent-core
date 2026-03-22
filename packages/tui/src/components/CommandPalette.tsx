import { useState, useCallback } from "react";
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

export function CommandPalette({
  commands,
  onSelect,
  onClose,
}: CommandPaletteProps) {
  const { width } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
    } else if (key.name === "up") {
      setSelectedIndex((i) => (i > 0 ? i - 1 : commands.length - 1));
    } else if (key.name === "down") {
      setSelectedIndex((i) => (i < commands.length - 1 ? i + 1 : 0));
    } else if (key.name === "return") {
      const cmd = commands[selectedIndex];
      if (cmd) onSelect(cmd.value);
    }
  });

  const rule = hrule(width);

  return (
    <box flexDirection="column">
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>
      <box paddingX={2} height={1} flexDirection="row">
        <text fg={colors.primary}>{"Commands "}</text>
        <text fg={colors.textMuted}>{"(↑↓ navigate, Enter select, Esc close)"}</text>
      </box>
      <box flexDirection="column" paddingX={1}>
        {commands.map((cmd, i) => {
          const isSelected = i === selectedIndex;
          const indicator = isSelected ? `${symbols.userPrefix} ` : "  ";
          const nameColor = isSelected ? colors.primary : colors.text;
          return (
            <box key={cmd.value} height={1} flexDirection="row">
              <text fg={colors.accent}>{indicator}</text>
              <text fg={nameColor}>{cmd.name}</text>
              <text fg={colors.textMuted}>{`  ${cmd.description}`}</text>
            </box>
          );
        })}
      </box>
      <box height={1}>
        <text fg={colors.border}>{rule}</text>
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
    description: "Start a new thread (keeps history)",
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
