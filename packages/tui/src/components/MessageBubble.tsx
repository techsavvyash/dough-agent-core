import type { Message } from "../hooks/useSession.ts";
import { ToolCallView } from "./ToolCallView.tsx";
import { colors, symbols } from "../theme.ts";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { role, content, isStreaming, thought, toolCalls } = message;

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
    const hasContent = content.length > 0;

    return (
      <box flexDirection="column">
        {/* Thought block — shown dimmed above the response */}
        {thought && (
          <box paddingX={1} flexDirection="row">
            <text fg={colors.primary}>{symbols.assistantPrefix} </text>
            <text fg={colors.textMuted}>{thought}</text>
          </box>
        )}

        {/* Tool calls */}
        {toolCalls && toolCalls.length > 0 && (
          <box flexDirection="column">
            {toolCalls.map((tc) => (
              <ToolCallView key={tc.callId} toolCall={tc} />
            ))}
          </box>
        )}

        {/* Main content */}
        {hasContent && (
          <box flexDirection="row" paddingX={1}>
            {!thought && !toolCalls?.length && (
              <text fg={colors.primary}>{symbols.assistantPrefix} </text>
            )}
            {(thought || (toolCalls && toolCalls.length > 0)) && (
              <text fg={colors.primary}>{symbols.assistantPrefix} </text>
            )}
            <text fg={colors.text} wrap="wrap">
              {content}
              {cursor}
            </text>
          </box>
        )}

        {/* Streaming cursor when no content yet (thinking state) */}
        {!hasContent && isStreaming && !thought && (!toolCalls || toolCalls.length === 0) && (
          <box flexDirection="row" paddingX={1}>
            <text fg={colors.primary}>{symbols.assistantPrefix} </text>
            <text fg={colors.warning}>{cursor}</text>
          </box>
        )}
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
