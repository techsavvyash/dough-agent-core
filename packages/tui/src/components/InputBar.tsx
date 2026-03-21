import { useCallback, useRef } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { InputRenderable } from "@opentui/core";
import { colors, symbols, hrule } from "../theme.ts";

interface InputBarProps {
  onSubmit: (text: string) => void;
  isStreaming: boolean;
  onAbort: () => void;
}

export function InputBar({ onSubmit, isStreaming, onAbort }: InputBarProps) {
  const inputRef = useRef<InputRenderable>(null);
  const { width } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === "escape" && isStreaming) {
      onAbort();
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
  const hint = isStreaming ? "Esc to cancel" : "? for shortcuts";

  return (
    <box flexDirection="column">
      <box><text fg={colors.border}>{rule}</text></box>
      <box flexDirection="row">
        <box width={3} paddingLeft={1}>
          <text fg={prefixColor}>{prefix} </text>
        </box>
        <input
          ref={inputRef}
          focused
          placeholder={isStreaming ? "Thinking..." : ""}
          onSubmit={handleSubmit}
        />
      </box>
      <box><text fg={colors.border}>{rule}</text></box>
      <box paddingX={2}>
        <text fg={colors.textMuted}>{hint}</text>
      </box>
    </box>
  );
}
