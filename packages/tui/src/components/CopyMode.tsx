import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { Message } from "../hooks/useSession.ts";
import { colors, symbols, hrule } from "../theme.ts";

interface CopyModeProps {
  messages: Message[];
  onClose: () => void;
}

/**
 * Copy mode overlay — lets the user copy message content to clipboard.
 *
 * Shows the last N assistant/user messages numbered.
 * Press 1-9 to copy that message, or Esc/q to close.
 * Uses pbcopy (macOS) or xclip (Linux) via Bun.spawn.
 */
export function CopyMode({ messages, onClose }: CopyModeProps) {
  const { width } = useTerminalDimensions();
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Get last 9 assistant/user messages with content
  const candidates = messages
    .filter((m) => (m.role === "assistant" || m.role === "user") && m.content.trim())
    .slice(-9)
    .reverse();

  async function copyToClipboard(text: string, idx: number) {
    try {
      const isMac = process.platform === "darwin";
      const args = isMac ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
      const proc = Bun.spawn(args, { stdin: "pipe" });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited;
      setCopied(idx);
      setTimeout(() => {
        setCopied(null);
        onClose();
      }, 800);
    } catch {
      setError("clipboard copy failed");
      setTimeout(() => setError(null), 2000);
    }
  }

  useKeyboard((key) => {
    if (key.name === "escape" || key.sequence === "q") {
      onClose();
      return;
    }
    // Number keys 1-9
    const num = parseInt(key.sequence ?? "", 10);
    if (!isNaN(num) && num >= 1 && num <= candidates.length) {
      const msg = candidates[num - 1];
      if (msg) copyToClipboard(msg.content, num);
    }
  });

  const rule = hrule(width);
  const headerText = " Copy Mode — press number to copy, Esc to close ";

  return (
    <box flexDirection="column" height="100%">
      {/* Header */}
      <box height={1}>
        <text fg={colors.accent}>
          {rule.slice(0, Math.max(0, Math.floor((width - headerText.length) / 2))) +
            headerText}
        </text>
      </box>

      {/* Message list */}
      <scrollbox flex={1}>
        {candidates.map((msg, i) => {
          const num = i + 1;
          const isCopied = copied === num;
          const roleColor = msg.role === "assistant" ? colors.primary : colors.accent;
          const roleLabel =
            msg.role === "assistant" ? symbols.assistantPrefix : symbols.userPrefix;
          const preview =
            msg.content.length > (width - 8) * 4
              ? msg.content.slice(0, (width - 8) * 4) + "\n…"
              : msg.content;

          return (
            <box key={msg.id} flexDirection="column" marginBottom={1} paddingX={1}>
              <box flexDirection="row" height={1}>
                <text fg={isCopied ? colors.success : colors.warning}>
                  {String("[") + String(num) + String("] ")}
                </text>
                <text fg={roleColor}>{roleLabel + " "}</text>
                <text fg={colors.textMuted}>{msg.role}</text>
                {isCopied && <text fg={colors.success}>{" \u2713 copied!"}</text>}
              </box>
              <box paddingLeft={4}>
                <text fg={colors.textDim} wrapMode="word" flex={1}>
                  {preview}
                </text>
              </box>
            </box>
          );
        })}
        {candidates.length === 0 && (
          <box paddingX={2} paddingY={1}>
            <text fg={colors.textMuted}>{"No messages to copy yet."}</text>
          </box>
        )}
      </scrollbox>

      {/* Footer */}
      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>
          {error ?? "Press 1-9 to copy  \u00b7  Esc to close"}
        </text>
      </box>
    </box>
  );
}
