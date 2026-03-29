import type { Message } from "../hooks/useSession.ts";
import { MessageBubble } from "./MessageBubble.tsx";
import { LiveActivityBar } from "./LiveActivityBar.tsx";

interface ChatViewProps {
  messages: Message[];
  isStreaming: boolean;
}

export function ChatView({ messages, isStreaming }: ChatViewProps) {
  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={2}>
      {messages.map((msg) => (
        /*
         * Each message sits in its own wrapper with bottom margin so there's
         * consistent breathing room regardless of message content height.
         * gap={} on the parent would add space even before the first message;
         * marginBottom on each child is more predictable.
         */
        <box key={msg.id} flexDirection="column" marginBottom={1}>
          <MessageBubble message={msg} />
        </box>
      ))}
      {isStreaming && <LiveActivityBar messages={messages} />}
    </box>
  );
}
