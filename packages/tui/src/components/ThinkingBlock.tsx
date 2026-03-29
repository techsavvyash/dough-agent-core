import { useState, useEffect } from "react";
import { useKeyboard } from "@opentui/react";
import { colors, symbols } from "../theme.ts";

interface ThinkingBlockProps {
  thought: string;
  isStreaming?: boolean;
}

/**
 * Thought / reasoning display with two modes:
 *
 * STREAMING  → compact animated pill: "💭 ⠙ Thinking... 8s"
 *              The growing thought text is hidden to avoid the "stuck wall
 *              of text" problem — the LiveActivityBar already signals progress.
 *
 * DONE       → collapsed single-line summary (Space to expand full text)
 */
export function ThinkingBlock({ thought, isStreaming = false }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Spinner + elapsed counter — only runs while streaming
  useEffect(() => {
    if (!isStreaming) return;
    const spinInterval = setInterval(
      () => setFrame((f) => (f + 1) % symbols.spinnerFrames.length),
      80,
    );
    const tickInterval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(spinInterval);
      clearInterval(tickInterval);
    };
  }, [isStreaming]);

  // Space toggles expand/collapse when done streaming
  useKeyboard((key) => {
    if (key.name === "space" && !isStreaming) {
      setExpanded((prev) => !prev);
    }
  });

  // ── STREAMING MODE ──────────────────────────────────────────────────────────
  if (isStreaming) {
    const spinner = symbols.spinnerFrames[frame] ?? symbols.spinnerFrames[0]!;
    const elapsedStr = elapsed > 0 ? `  ${String(elapsed)}s` : "";
    return (
      <box paddingX={1} height={1} flexDirection="row" marginBottom={1}>
        <box width={2} flexShrink={0}>
          <text fg={colors.primary}>{symbols.thought}</text>
        </box>
        <box width={2} flexShrink={0}>
          <text fg={colors.secondary}>{spinner}</text>
        </box>
        <text fg={colors.secondary}>{`Thinking...${elapsedStr}`}</text>
      </box>
    );
  }

  // ── DONE — EXPANDED ─────────────────────────────────────────────────────────
  const lines = thought
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (expanded) {
    const wordCount = thought.split(/\s+/).filter(Boolean).length;
    return (
      <box paddingX={1} flexDirection="column" marginBottom={1}>
        <box flexDirection="row">
          <box width={2} flexShrink={0}>
            <text fg={colors.primary}>{symbols.thought}</text>
          </box>
          <text fg={colors.secondary} flex={1} wrapMode="word">
            {lines.join(" ")}
          </text>
        </box>
        <box paddingLeft={2} height={1}>
          <text fg={colors.textMuted}>{`${String(wordCount)} words  [Space ▲ collapse]`}</text>
        </box>
      </box>
    );
  }

  // ── DONE — COLLAPSED ────────────────────────────────────────────────────────
  const firstLine = lines[0] ?? "";
  const summary =
    firstLine.length > 120 ? firstLine.slice(0, 120) + "…" : firstLine;
  const wordCount = thought.split(/\s+/).filter(Boolean).length;

  return (
    <box paddingX={1} height={1} flexDirection="row" marginBottom={1}>
      <box width={2} flexShrink={0}>
        <text fg={colors.primary}>{symbols.thought}</text>
      </box>
      <text fg={colors.textMuted} flex={1} wrapMode="word">
        {`${summary}  `}
      </text>
      <text fg={colors.textMuted}>{`${String(wordCount)}w [Space ▼]`}</text>
    </box>
  );
}
