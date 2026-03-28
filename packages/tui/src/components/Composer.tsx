import { useCallback, useRef, useState, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { TextareaRenderable } from "@opentui/core";
import type { Attachment, ChangeStats } from "@dough/protocol";
import { colors, symbols, hrule } from "../theme.ts";
import { pasteImageFromClipboard } from "../hooks/useClipboard.ts";

interface ComposerProps {
  onSubmit: (text: string, attachments?: Attachment[]) => void;
  isStreaming: boolean;
  queuedCount: number;
  onAbort: () => void;
  onOpenPalette?: () => void;
  paletteOpen?: boolean;
  stats: ChangeStats;
  hasChanges: boolean;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`;
  return `${s}s`;
}

// Enter → submit, Shift+Enter → newline
const KEY_BINDINGS = [
  { name: "return", action: "submit" as const },
  { name: "return", shift: true, action: "newline" as const },
];

// Cap before we eat the whole screen; beyond this the textarea scrolls internally
const MAX_COMPOSER_LINES = 16;

export function Composer({
  onSubmit,
  isStreaming,
  queuedCount,
  onAbort,
  onOpenPalette,
  paletteOpen = false,
  stats,
  hasChanges,
}: ComposerProps) {
  const inputRef = useRef<TextareaRenderable>(null);
  const mountedRef = useRef(true);
  const { width } = useTerminalDimensions();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [pasteStatus, setPasteStatus] = useState<string | null>(null);
  const [inputLines, setInputLines] = useState(1);

  useEffect(() => {
    if (!isStreaming) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  useKeyboard((_key) => {
    // Recompute visual line count after every keystroke as a reliable fallback
    // for when onContentChange fires before the buffer has been fully updated.
    setTimeout(() => { if (mountedRef.current) updateInputLines(); }, 0);

    const key = _key;
    if (key.name === "escape" && isStreaming) {
      onAbort();
      return;
    }
    if (key.sequence === "?" && !isStreaming && !paletteOpen && onOpenPalette) {
      const currentValue = inputRef.current?.editBuffer.getText() ?? "";
      if (currentValue === "" || currentValue === "?") {
        // Use setTimeout so the clear runs after the textarea's own key-insert
        // handler — otherwise the "?" lands in the buffer after our setText("").
        setTimeout(() => {
          if (!mountedRef.current) return;
          try { inputRef.current?.editBuffer.setText(""); } catch { /* destroyed */ }
          setInputLines(1);
        }, 0);
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

  const handleSubmit = useCallback(() => {
    const raw = inputRef.current?.editBuffer.getText() ?? "";
    const trimmed = raw.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    // Allow submission while streaming — the server will queue it.
    onSubmit(trimmed, pendingAttachments.length > 0 ? pendingAttachments : undefined);
    setPendingAttachments([]);
    inputRef.current?.editBuffer.setText("");
    setInputLines(1);
  }, [onSubmit, pendingAttachments]);

  // Track visual line count for dynamic composer height.
  // We must account for word-wrap: a single long logical line takes multiple
  // visual rows. Available width = terminal - paddingX(1+1) - prefix box(2).
  const updateInputLines = useCallback(() => {
    if (!mountedRef.current) return;
    let text = "";
    try { text = inputRef.current?.editBuffer.getText() ?? ""; } catch { return; }
    const availableWidth = Math.max(1, width - 4);
    const visualCount = text.split("\n").reduce((sum, line) => {
      return sum + Math.max(1, Math.ceil(line.length / availableWidth));
    }, 0);
    setInputLines(Math.min(MAX_COMPOSER_LINES, Math.max(1, visualCount)));
  }, [width]);

  const handleContentChange = useCallback(() => {
    updateInputLines();
  }, [updateInputLines]);

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

  // ── Placeholder text (prefix rendered separately so it never disappears) ──
  const placeholder = "Type a message...";
  const prefixColor = colors.textDim;

  // ── Build footer parts ─────────────────────────────────
  const footerParts: string[] = [];
  if (isStreaming) {
    footerParts.push("Esc cancel");
    footerParts.push("Enter queues");
  } else {
    footerParts.push("? commands");
    footerParts.push("Ctrl+V image");
    footerParts.push("Shift+Enter newline");
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

  // Grows with content up to MAX_COMPOSER_LINES, then scrolls internally
  const visibleLines = Math.min(MAX_COMPOSER_LINES, inputLines);
  // Total composer height = separator(1) + visible input rows + footer(1)
  const composerHeight = 2 + visibleLines;

  return (
    <box flexDirection="column" height={composerHeight}>
      {/* Top separator — embeds thinking indicator on the left when streaming */}
      <box height={1}>
        <text fg={isStreaming ? colors.warning : colors.border}>{topBorder}</text>
      </box>

      {/* Input area — prefix is permanent, textarea shows MIN_VISIBLE_LINES rows minimum */}
      <box paddingX={1} height={visibleLines} flexDirection="row">
        <box width={2} flexShrink={0}>
          <text fg={colors.primary}>{symbols.userPrefix}</text>
        </box>
        <textarea
          ref={inputRef}
          focused={!paletteOpen}
          placeholder={placeholder}
          onSubmit={handleSubmit}
          onContentChange={handleContentChange}
          textColor={colors.text}
          placeholderColor={prefixColor}
          keyBindings={KEY_BINDINGS}
          wrapMode="word"
        />
      </box>

      {/* Footer: hints left, stats right */}
      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>{footer}</text>
      </box>
    </box>
  );
}
