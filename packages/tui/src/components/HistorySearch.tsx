import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { Message } from "../hooks/useSession.ts";
import { colors, symbols } from "../theme.ts";

interface HistorySearchProps {
  messages: Message[];
  onSelect: (text: string) => void;
  onClose: () => void;
}

/**
 * Reverse history search overlay — shown at the bottom of the screen.
 * Filters past user messages as you type; Enter fills the composer.
 * Esc closes without selecting.
 */
export function HistorySearch({ messages, onSelect, onClose }: HistorySearchProps) {
  const [query, setQuery] = useState("");

  // Extract unique user messages (most recent first)
  const userMessages = messages
    .filter((m) => m.role === "user" && m.content.trim())
    .map((m) => m.content)
    .reverse()
    .filter((text, idx, arr) => arr.indexOf(text) === idx); // dedupe

  const filtered = query.trim()
    ? userMessages.filter((m) =>
        m.toLowerCase().includes(query.toLowerCase())
      )
    : userMessages;

  const top5 = filtered.slice(0, 5);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "return") {
      if (top5[0]) onSelect(top5[0]);
      onClose();
      return;
    }
    if (key.name === "backspace") {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    // Printable characters
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + key.sequence);
    }
  });

  return (
    <box flexDirection="column" border={["top"]} borderStyle="single" borderColor={colors.borderActive}>
      <box height={1} paddingX={1} flexDirection="row">
        <text fg={colors.primary}>{`${symbols.userPrefix} history search: `}</text>
        <text fg={colors.text}>{query}</text>
        <text fg={colors.warning}>{symbols.cursor}</text>
      </box>
      {top5.map((text, i) => {
        const display = text.length > 80 ? text.slice(0, 80) + "…" : text;
        return (
          <box key={i} height={1} paddingX={3}>
            <text fg={i === 0 ? colors.accent : colors.textDim}>{display}</text>
          </box>
        );
      })}
      {top5.length === 0 && (
        <box height={1} paddingX={3}>
          <text fg={colors.textMuted}>{"no matches"}</text>
        </box>
      )}
    </box>
  );
}
