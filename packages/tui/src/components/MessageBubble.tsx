import type { Message } from "../hooks/useSession.ts";
import { colors, symbols } from "../theme.ts";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { role, content, isStreaming } = message;

  if (role === "user") {
    return (
      <box flexDirection="row" paddingX={1}>
        <text fg={colors.accent}>{symbols.userPrefix} </text>
        <text fg={colors.text}>{content}</text>
      </box>
    );
  }

  if (role === "assistant") {
    const cursor = isStreaming ? symbols.cursor : "";
    return (
      <box flexDirection="row" paddingX={1}>
        <text fg={colors.primary}>{symbols.assistantPrefix} </text>
        <text fg={colors.text} wrap="wrap">{content}{cursor}</text>
      </box>
    );
  }

  if (role === "system") {
    return (
      <box paddingX={3}>
        <text fg={colors.textMuted}>{content}</text>
      </box>
    );
  }

  return (
    <box paddingX={3}>
      <text fg={colors.textDim}>{content}</text>
    </box>
  );
}
