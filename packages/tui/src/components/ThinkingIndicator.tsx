import { useState, useEffect } from "react";
import { colors, symbols } from "../theme.ts";

interface ThinkingIndicatorProps {
  /** Optional label text shown after the spinner */
  label?: string;
}

/**
 * Animated braille spinner shown while the assistant is thinking
 * before any content has been emitted.
 */
export function ThinkingIndicator({
  label = "Thinking",
}: ThinkingIndicatorProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % symbols.spinnerFrames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  const spinner = symbols.spinnerFrames[frame];

  return (
    <box height={1} paddingX={1} flexDirection="row">
      <text fg={colors.primary}>{symbols.assistantPrefix} </text>
      <text fg={colors.warning}>{spinner} </text>
      <text fg={colors.textDim}>{label}</text>
    </box>
  );
}
