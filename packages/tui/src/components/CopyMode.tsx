import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Message } from "../hooks/useSession.ts";
import { colors, symbols, hrule } from "../theme.ts";

interface CopyModeProps {
  messages: Message[];
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Split message content into display lines, wrapping at `width`. */
function wrapText(text: string, width: number): string[] {
  const result: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) {
      result.push("");
      continue;
    }
    let remaining = raw;
    while (remaining.length > width) {
      result.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    result.push(remaining);
  }
  return result;
}

interface LineEntry {
  /** Index into the messages array */
  msgIdx: number;
  /** The text of this line */
  text: string;
  /** Whether this is a header/prefix line (role label) */
  isHeader: boolean;
}

/** Build a flat list of display lines from messages. */
function buildLines(messages: Message[], width: number): LineEntry[] {
  const contentWidth = Math.max(width - 6, 20); // account for padding/prefix
  const lines: LineEntry[] = [];

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (!msg.content.trim() && msg.role !== "system") continue;

    // Role header
    const prefix =
      msg.role === "user"
        ? `${symbols.userPrefix} `
        : msg.role === "assistant"
          ? `${symbols.assistantPrefix} `
          : `${symbols.info} `;
    lines.push({ msgIdx: mi, text: prefix + msg.role, isHeader: true });

    // Content lines
    const wrapped = wrapText(msg.content, contentWidth);
    for (const line of wrapped) {
      lines.push({ msgIdx: mi, text: line, isHeader: false });
    }

    // Blank separator
    lines.push({ msgIdx: mi, text: "", isHeader: false });
  }

  return lines;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const isMac = process.platform === "darwin";
    const args = isMac ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
    const proc = Bun.spawn(args, { stdin: "pipe" });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    return true;
  } catch {
    return false;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Tmux-style copy mode overlay.
 *
 * Navigation:
 *   j/Down  — move cursor down
 *   k/Up    — move cursor up
 *   g       — jump to top
 *   G       — jump to bottom
 *   v       — toggle visual (selection) mode
 *   y/Enter — copy selection (or current line) to clipboard
 *   Esc/q   — exit copy mode
 */
export function CopyMode({ messages, onClose }: CopyModeProps) {
  const { width, height } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);
  const [anchor, setAnchor] = useState<number | null>(null); // visual mode anchor
  const [scrollOffset, setScrollOffset] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lines = useMemo(() => buildLines(messages, width), [messages, width]);
  const totalLines = lines.length;
  // 2 = header + footer
  const viewportHeight = Math.max(height - 2, 1);

  // Clamp cursor when lines change
  useEffect(() => {
    if (cursor >= totalLines) setCursor(Math.max(0, totalLines - 1));
  }, [totalLines, cursor]);

  // Keep cursor in viewport
  useEffect(() => {
    if (cursor < scrollOffset) setScrollOffset(cursor);
    else if (cursor >= scrollOffset + viewportHeight)
      setScrollOffset(cursor - viewportHeight + 1);
  }, [cursor, scrollOffset, viewportHeight]);

  // Start with cursor at bottom (most recent message)
  useEffect(() => {
    const bottom = Math.max(0, totalLines - 1);
    setCursor(bottom);
    setScrollOffset(Math.max(0, totalLines - viewportHeight));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showFlash = useCallback(
    (text: string) => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      setFlash(text);
      flashTimer.current = setTimeout(() => {
        setFlash(null);
        onClose();
      }, 600);
    },
    [onClose],
  );

  const isVisual = anchor !== null;
  const selStart = isVisual ? Math.min(anchor, cursor) : cursor;
  const selEnd = isVisual ? Math.max(anchor, cursor) : cursor;

  const doCopy = useCallback(async () => {
    const selected = lines
      .slice(selStart, selEnd + 1)
      .filter((l) => !l.isHeader)
      .map((l) => l.text)
      .join("\n")
      .trim();

    if (!selected) return;
    const ok = await copyToClipboard(selected);
    showFlash(ok ? "\u2713 Copied!" : "\u2717 Copy failed");
  }, [lines, selStart, selEnd, showFlash]);

  useKeyboard((key) => {
    if (flash) return; // ignore input during flash

    // Exit
    if (key.name === "escape" || key.sequence === "q") {
      if (isVisual) {
        setAnchor(null); // exit visual first
        return;
      }
      onClose();
      return;
    }

    // Move down
    if (key.name === "down" || key.sequence === "j") {
      setCursor((c) => Math.min(c + 1, totalLines - 1));
      return;
    }

    // Move up
    if (key.name === "up" || key.sequence === "k") {
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }

    // Page down
    if (key.name === "pagedown" || (key.ctrl && key.name === "d")) {
      setCursor((c) => Math.min(c + viewportHeight, totalLines - 1));
      return;
    }

    // Page up
    if (key.name === "pageup" || (key.ctrl && key.name === "u")) {
      setCursor((c) => Math.max(c - viewportHeight, 0));
      return;
    }

    // Jump top
    if (key.sequence === "g") {
      setCursor(0);
      return;
    }

    // Jump bottom
    if (key.sequence === "G") {
      setCursor(totalLines - 1);
      return;
    }

    // Toggle visual mode
    if (key.sequence === "v") {
      if (isVisual) {
        setAnchor(null);
      } else {
        setAnchor(cursor);
      }
      return;
    }

    // Copy
    if (key.sequence === "y" || key.name === "return") {
      doCopy();
      return;
    }
  });

  // Visible lines
  const visible = lines.slice(scrollOffset, scrollOffset + viewportHeight);
  const rule = hrule(width);

  // Mode label
  const modeLabel = isVisual
    ? ` VISUAL (${selEnd - selStart + 1} lines) `
    : " COPY ";

  return (
    <box flexDirection="column" height="100%">
      {/* Header */}
      <box height={1} flexDirection="row">
        <text fg={colors.accent}>
          {rule.slice(0, Math.max(0, 2)) +
            modeLabel +
            rule.slice(0, Math.max(0, width - modeLabel.length - 2))}
        </text>
      </box>

      {/* Lines */}
      <box flexDirection="column" flex={1}>
        {visible.map((entry, vi) => {
          const globalIdx = scrollOffset + vi;
          const isCursorLine = globalIdx === cursor;
          const isSelected = globalIdx >= selStart && globalIdx <= selEnd && isVisual;

          // Colors
          let fg = entry.isHeader ? colors.primary : colors.textDim;
          let bg: string | undefined;

          if (isCursorLine) {
            fg = colors.text;
            bg = "#2A2A3A";
          }
          if (isSelected) {
            fg = colors.text;
            bg = "#3A3A5A";
          }
          if (isCursorLine && isSelected) {
            bg = "#4A4A6A";
          }

          const indicator = isCursorLine ? "\u25B8 " : "  ";

          return (
            <box key={String(globalIdx)} height={1} width={width} bg={bg}>
              <text fg={isCursorLine ? colors.accent : colors.textMuted}>
                {indicator}
              </text>
              <text fg={fg} flex={1}>
                {entry.text || " "}
              </text>
            </box>
          );
        })}
      </box>

      {/* Footer */}
      <box height={1} paddingX={1}>
        <text fg={flash ? colors.success : colors.textMuted}>
          {flash ??
            "j/k move  \u00b7  v visual  \u00b7  y copy  \u00b7  g/G top/bottom  \u00b7  Esc close"}
        </text>
      </box>
    </box>
  );
}
