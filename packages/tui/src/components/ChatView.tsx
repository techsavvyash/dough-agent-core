import type { Message } from "../hooks/useSession.ts";
import { MessageBubble } from "./MessageBubble.tsx";

interface ChatViewProps {
  messages: Message[];
}

export function ChatView({ messages }: ChatViewProps) {
  return (
    <box flexDirection="column" gap={1} paddingY={1}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </box>
  );
}
