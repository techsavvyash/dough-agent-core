import { useCallback, useRef, useState, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { InputRenderable } from "@opentui/core";
import { colors, symbols, hrule } from "../theme.ts";

interface InputBarProps {
  onSubmit: (text: string) => void;
  isStreaming: boolean;
  onAbort: () => void;
  onOpenPalette?: () => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`;
  return `${s}s`;
}

export function InputBar({ onSubmit, isStreaming, onAbort, onOpenPalette }: InputBarProps) {
  const inputRef = useRef<InputRenderable>(null);
  const { width } = useTerminalDimensions();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStreaming) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  useKeyboard((key) => {
    if (key.name === "escape" && isStreaming) {
      onAbort();
      return;
    }
    // Open the command palette immediately when '?' is typed on an empty input
    if (
      key.sequence === "?" &&
      !isStreaming &&
      onOpenPalette
    ) {
      const currentValue = inputRef.current?.value ?? "";
      // Trigger only if the input is empty (before the char lands) or just has "?"
      if (currentValue === "" || currentValue === "?") {
        if (inputRef.current) inputRef.current.value = "";
        onOpenPalette();
      }
    }
  });

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || isStreaming) return;
      onSubmit(trimmed);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [isStreaming, onSubmit]
  );

  const rule = hrule(width);
  const prefix = isStreaming ? symbols.thinking : symbols.userPrefix;
  const prefixColor = isStreaming ? colors.warning : colors.primary;
  const timer = isStreaming && elapsed > 0 ? ` [${formatElapsed(elapsed)}]` : "";

  return (
    <box flexDirection="column">
      <box height={1}><text fg={colors.border}>{rule}</text></box>
      <box height={1} paddingLeft={1}>
        <input
          ref={inputRef}
          focused
          placeholder={isStreaming ? `${prefix} Thinking...${timer} (Esc to cancel)` : `${prefix} Type a message... (? for commands)`}
          onSubmit={(v: unknown) => handleSubmit(String(v))}
          textColor={colors.text}
          placeholderColor={prefixColor}
        />
      </box>
    </box>
  );
}
