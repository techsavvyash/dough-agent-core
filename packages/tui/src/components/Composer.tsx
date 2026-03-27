import { useCallback, useRef, useState, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { InputRenderable } from "@opentui/core";
import type { Attachment, ChangeStats } from "@dough/protocol";
import { colors, symbols, hrule } from "../theme.ts";
import { pasteImageFromClipboard } from "../hooks/useClipboard.ts";

interface ComposerProps {
  onSubmit: (text: string, attachments?: Attachment[]) => void;
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
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [pasteStatus, setPasteStatus] = useState<string | null>(null);

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
    // Ctrl+V: paste image from clipboard
    if (key.ctrl && key.name === "v" && !isStreaming) {
      setPasteStatus("Reading clipboard…");
      pasteImageFromClipboard().then((attachment) => {
        if (attachment) {
          setPendingAttachments((prev) => [...prev, attachment]);
          setPasteStatus(null);
        } else {
          setPasteStatus("No image in clipboard");
          setTimeout(() => setPasteStatus(null), 2000);
        }
      });
    }
  });

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed && pendingAttachments.length === 0) return;
      // Allow submission while streaming — the server will queue it.
      onSubmit(trimmed, pendingAttachments.length > 0 ? pendingAttachments : undefined);
      setPendingAttachments([]);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [onSubmit, pendingAttachments]
  );

  // ── Build top border with thinking indicator ───────────
  const timer =
    isStreaming && elapsed > 0 ? ` [${formatElapsed(elapsed)}]` : "";
  const thinkingSegment = isStreaming
    ? ` ${symbols.thinking} Thinking...${timer} `
    : "";
  const ruleBase = symbols.hrule;
  const topBorder = isStreaming
    ? `${ruleBase}${thinkingSegment}${symbols.hrule.repeat(
        Math.max(0, width - 1 - thinkingSegment.length)
      )}`
    : hrule(width);

  // ── Placeholder is always the normal prompt ────────────
  const placeholder = `${symbols.userPrefix} Type a message...`;
  const prefixColor = colors.primary;

  // ── Build footer parts ─────────────────────────────────
  const footerParts: string[] = [];
  if (isStreaming) {
    footerParts.push("Esc cancel");
    footerParts.push("Enter queues");
  } else {
    footerParts.push("? commands");
    footerParts.push("Ctrl+V image");
  }
  if (queuedCount > 0) {
    const label = queuedCount === 1 ? "message" : "messages";
    footerParts.push(`${queuedCount} ${label} queued`);
  }
  if (hasChanges) {
    footerParts.push("Ctrl+D diffs");
  }
  if (pasteStatus) {
    footerParts.push(pasteStatus);
  } else if (pendingAttachments.length > 0) {
    const label = pendingAttachments.length === 1 ? "image" : "images";
    footerParts.push(`📎 ${pendingAttachments.length} ${label} attached`);
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

  return (
    <box flexDirection="column" height={3}>
      {/* Top separator — embeds thinking indicator on the left when streaming */}
      <box height={1}>
        <text fg={isStreaming ? colors.warning : colors.border}>{topBorder}</text>
      </box>

      {/* Input area */}
      <box paddingX={1} height={1}>
        <input
          ref={inputRef}
          focused
          placeholder={placeholder}
          onSubmit={(v: unknown) => handleSubmit(String(v))}
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
