import { useCallback, useRef, useState, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { InputRenderable } from "@opentui/core";
import type { ChangeStats } from "@dough/protocol";
import { colors, symbols, hrule } from "../theme.ts";

interface ComposerProps {
  onSubmit: (text: string) => void;
  isStreaming: boolean;
  queuedCount: number;
  onAbort: () => void;
  onOpenPalette?: () => void;
  stats: ChangeStats;
  hasChanges: boolean;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`;
  return `${s}s`;
}

export function Composer({
  onSubmit,
  isStreaming,
  queuedCount,
  onAbort,
  onOpenPalette,
  stats,
  hasChanges,
}: ComposerProps) {
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
    if (key.sequence === "?" && !isStreaming && onOpenPalette) {
      const currentValue = inputRef.current?.value ?? "";
      if (currentValue === "" || currentValue === "?") {
        if (inputRef.current) inputRef.current.value = "";
        onOpenPalette();
      }
    }
  });

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      // Allow submission while streaming — the server will queue it.
      onSubmit(trimmed);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [onSubmit]
  );

  // ── Build placeholder ──────────────────────────────────
  const timer =
    isStreaming && elapsed > 0 ? ` [${formatElapsed(elapsed)}]` : "";
  const placeholder = isStreaming
    ? `${symbols.thinking} Thinking...${timer} — Enter to queue`
    : `${symbols.userPrefix} Type a message...`;
  const prefixColor = isStreaming ? colors.warning : colors.primary;

  // ── Build footer parts ─────────────────────────────────
  const footerParts: string[] = [];
  if (isStreaming) {
    footerParts.push("Esc cancel");
  } else {
    footerParts.push("? commands");
  }
  if (queuedCount > 0) {
    const label = queuedCount === 1 ? "message" : "messages";
    footerParts.push(`${queuedCount} ${label} queued`);
  }
  if (hasChanges) {
    footerParts.push("Ctrl+D diffs");
  }

  let statsText = "";
  if (stats.filesChanged > 0) {
    const label = stats.filesChanged === 1 ? "file" : "files";
    statsText = `${stats.filesChanged} ${label} changed +${stats.totalAdded} -${stats.totalRemoved}`;
  }

  const footerLeft = footerParts.join(`  ${symbols.dot}  `);
  const footerRight = statsText;
  // Pad so right-side text aligns to the right edge
  const footerGap = Math.max(
    1,
    width - 4 - footerLeft.length - footerRight.length
  );
  const footer = footerRight
    ? `${footerLeft}${" ".repeat(footerGap)}${footerRight}`
    : footerLeft;

  const rule = hrule(width);

  return (
    <box flexDirection="column" height={3}>
      {/* Top separator — changes color when streaming */}
      <box height={1}>
        <text fg={isStreaming ? colors.warning : colors.border}>{rule}</text>
      </box>

      {/* Input area */}
      <box paddingX={1} height={1}>
        <input
          ref={inputRef}
          focused
          placeholder={placeholder}
          onSubmit={handleSubmit}
          textColor={colors.text}
          placeholderColor={prefixColor}
        />
      </box>

      {/* Footer: hints left, stats right */}
      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>{footer}</text>
      </box>
    </box>
  );
}
