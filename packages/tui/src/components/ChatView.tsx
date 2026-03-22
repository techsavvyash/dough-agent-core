import type { Message } from "../hooks/useSession.ts";
import { MessageBubble } from "./MessageBubble.tsx";
import { ThinkingIndicator } from "./ThinkingIndicator.tsx";

interface ChatViewProps {
  messages: Message[];
  isStreaming: boolean;
}

export function ChatView({ messages, isStreaming }: ChatViewProps) {
  // Show thinking indicator when streaming but no assistant message has appeared yet
  const lastMsg = messages[messages.length - 1];
  const showThinking =
    isStreaming &&
    (!lastMsg || lastMsg.role === "user") &&
    messages.length > 0;

  return (
    <box flexDirection="column" gap={1} paddingY={1}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {showThinking && <ThinkingIndicator />}
    </box>
  );
}
