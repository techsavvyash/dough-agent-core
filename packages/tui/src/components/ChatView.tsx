import type { Message } from "../hooks/useSession.ts";
import { MessageBubble } from "./MessageBubble.tsx";
import { LiveActivityBar } from "./LiveActivityBar.tsx";

interface ChatViewProps {
  messages: Message[];
  isStreaming: boolean;
}

export function ChatView({ messages, isStreaming }: ChatViewProps) {
  return (
    <box flexDirection="column" gap={1} paddingY={1}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {/*
       * LiveActivityBar stays anchored below the last message for the entire
       * streaming turn — thinking, tool execution, and content phases all
       * show an animated label so the user always knows work is in progress.
       */}
      {isStreaming && <LiveActivityBar messages={messages} />}
    </box>
  );
}
