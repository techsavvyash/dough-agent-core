import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { colors, symbols } from "../theme.ts";

interface ThinkingBlockProps {
  thought: string;
  isStreaming?: boolean;
}

/**
 * Collapsible thought/reasoning display.
 * Shows the first line as a summary when collapsed.
 * Press Space to toggle expand/collapse (when this block has logical focus via context).
 *
 * Note: Since useKeyboard is global, the toggle key is exposed at the
 * MessageBubble level rather than here.
 */
export function ThinkingBlock({ thought, isStreaming = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  // Global Space key toggles the most-recently-rendered ThinkingBlock.
  // This is a best-effort UX since OpenTUI has no per-element focus for custom components.
  useKeyboard((key) => {
    if (key.name === "space" && !isStreaming) {
      setExpanded((prev) => !prev);
    }
  });

  const lines = thought
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const firstLine = lines[0] ?? "";
  const summary =
    firstLine.length > 120 ? firstLine.slice(0, 120) + "…" : firstLine;
  const toggleHint = isStreaming ? "" : expanded ? " [Space ▲]" : " [Space ▼]";

  if (expanded) {
    const fullText = lines.join(" ");
    return (
      <box paddingX={1} flexDirection="column" marginBottom={1}>
        <box flexDirection="row">
          <box width={2} flexShrink={0}>
            <text fg={colors.primary}>{symbols.thought}</text>
          </box>
          <text fg={colors.secondary} flex={1} wrapMode="word">
            {`${fullText}${toggleHint}`}
          </text>
        </box>
      </box>
    );
  }

  return (
    <box paddingX={1} flexDirection="column" marginBottom={1}>
      <box flexDirection="row">
        <box width={2} flexShrink={0}>
          <text fg={colors.primary}>{symbols.thought}</text>
        </box>
        <text fg={colors.textMuted} flex={1} wrapMode="word">
          {`${summary}${toggleHint}`}
        </text>
      </box>
    </box>
  );
}
