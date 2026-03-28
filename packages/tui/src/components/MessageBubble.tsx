import type { Message } from "../hooks/useSession.ts";
import { ToolCallView } from "./ToolCallView.tsx";
import { colors, symbols } from "../theme.ts";
import { getDoughSyntaxStyle } from "../utils/syntaxStyle.ts";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { role, content, isStreaming, thought, toolCalls } = message;
  const syntaxStyle = getDoughSyntaxStyle();

  if (role === "user") {
    return (
      <box flexDirection="row" paddingX={1}>
        <text fg={colors.accent}>{symbols.userPrefix} </text>
        <text fg={colors.text} flex={1} wrapMode="word">{content}</text>
      </box>
    );
  }

  if (role === "assistant") {
    const cursor = isStreaming ? symbols.cursor : "";
    const hasContent = content.length > 0;

    return (
      <box flexDirection="column">
        {/* Thought block — up to 3 lines, dimmed above the response */}
        {thought && (
          <box paddingX={1} flexDirection="column" marginBottom={1}>
            <box flexDirection="row">
              <box width={2} flexShrink={0}>
                <text fg={colors.primary}>{symbols.thought}</text>
              </box>
              <text fg={colors.textMuted} flex={1} wrapMode="word">
                {(() => {
                  const lines = thought
                    .split("\n")
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0)
                    .slice(0, 3);
                  const joined = lines.join(" ");
                  return joined.length > 300 ? joined.slice(0, 300) + "…" : joined;
                })()}
              </text>
            </box>
          </box>
        )}

        {/* Tool calls */}
        {toolCalls && toolCalls.length > 0 && (
          <box flexDirection="column" paddingTop={1}>
            {toolCalls.map((tc) => (
              <ToolCallView key={tc.callId} toolCall={tc} />
            ))}
          </box>
        )}

        {/* Main content — native markdown renderer */}
        {hasContent && (
          <box flexDirection="row" paddingX={1}>
            <box width={2} flexShrink={0}>
              <text fg={colors.primary}>{symbols.assistantPrefix}</text>
            </box>
            <box flex={1} flexDirection="column">
              <markdown
                content={content + cursor}
                syntaxStyle={syntaxStyle}
                fg={colors.text}
                conceal={true}
                concealCode={false}
                streaming={isStreaming ?? false}
              />
            </box>
          </box>
        )}

        {/* Streaming cursor with no content yet */}
        {!hasContent && isStreaming && !thought && (!toolCalls || toolCalls.length === 0) && (
          <box flexDirection="row" paddingX={1}>
            <box width={2} flexShrink={0}>
              <text fg={colors.primary}>{symbols.assistantPrefix}</text>
            </box>
            <text fg={colors.warning}>{cursor}</text>
          </box>
        )}
      </box>
    );
  }

  if (role === "system") {
    return <SystemMessage content={content} />;
  }

  return (
    <box paddingX={3}>
      <text fg={colors.textDim} flex={1} wrapMode="word">{content}</text>
    </box>
  );
}

/** Classifies a system message by scanning for keywords. */
function classifySystemMessage(content: string): "error" | "warning" | "hint" | "info" {
  const lower = content.toLowerCase();
  if (lower.includes("error") || lower.includes("failed") || lower.includes("fatal")) {
    return "error";
  }
  if (lower.includes("warn") || lower.includes("caution") || lower.includes("context")) {
    return "warning";
  }
  if (lower.includes("tip") || lower.includes("hint") || lower.includes("suggest")) {
    return "hint";
  }
  return "info";
}

interface SystemMessageConfig {
  icon: string;
  iconColor: string;
  borderColor: string;
}

function getSystemMessageConfig(kind: ReturnType<typeof classifySystemMessage>): SystemMessageConfig {
  switch (kind) {
    case "error":
      return { icon: symbols.errorIcon, iconColor: colors.error, borderColor: colors.error };
    case "warning":
      return { icon: symbols.contextWarn, iconColor: colors.warning, borderColor: colors.warning };
    case "hint":
      return { icon: symbols.hint, iconColor: colors.secondary, borderColor: colors.secondary };
    case "info":
    default:
      return { icon: symbols.info, iconColor: colors.primary, borderColor: colors.border };
  }
}

/** Highlighted system message box with icon, similar to gemini-cli's InfoMessage style. */
function SystemMessage({ content }: { content: string }) {
  const kind = classifySystemMessage(content);
  const { icon, iconColor, borderColor } = getSystemMessageConfig(kind);

  return (
    <box
      flexDirection="row"
      marginX={1}
      marginY={1}
      paddingX={1}
      border={["left"]}
      borderStyle="single"
      borderColor={borderColor}
    >
      <text fg={iconColor}>{icon} </text>
      <text fg={colors.textDim} flex={1} wrapMode="word">{content}</text>
    </box>
  );
}
