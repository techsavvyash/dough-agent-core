import { useState, useEffect, useCallback } from "react";
import { DoughEventType } from "@dough/protocol";
import type { DoughEvent, SessionMeta } from "@dough/protocol";
import type { DoughClient } from "../client.ts";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export function useSession(client: DoughClient) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsubEvent = client.onEvent((event: DoughEvent) => {
      switch (event.type) {
        case DoughEventType.ContentDelta:
          setIsStreaming(true);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.isStreaming && last.role === "assistant") {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + event.text },
              ];
            }
            return [
              ...prev,
              {
                id: event.streamId,
                role: "assistant",
                content: event.text,
                timestamp: new Date().toISOString(),
                isStreaming: true,
              },
            ];
          });
          break;

        case DoughEventType.ContentComplete:
          setIsStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, content: event.text, isStreaming: false },
              ];
            }
            return prev;
          });
          break;

        case DoughEventType.Finished:
          setIsStreaming(false);
          break;

        case DoughEventType.Error:
          setIsStreaming(false);
          setError(event.message);
          break;

        case DoughEventType.Aborted:
          setIsStreaming(false);
          break;

        case DoughEventType.ThreadHandoff:
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Thread handoff: context transferred to new thread`,
              timestamp: new Date().toISOString(),
            },
          ]);
          break;
      }
    });

    const unsubSession = client.onSession((s: SessionMeta) => {
      setSession(s);
    });

    const unsubError = client.onError((msg: string) => {
      setError(msg);
    });

    const unsubConnect = client.onConnect(() => setConnected(true));
    const unsubDisconnect = client.onDisconnect(() => setConnected(false));

    return () => {
      unsubEvent();
      unsubSession();
      unsubError();
      unsubConnect();
      unsubDisconnect();
    };
  }, [client]);

  const send = useCallback(
    (prompt: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: prompt,
          timestamp: new Date().toISOString(),
        },
      ]);
      setError(null);
      client.send(prompt);
    },
    [client]
  );

  const abort = useCallback(() => {
    client.abort();
  }, [client]);

  return { messages, isStreaming, session, error, connected, send, abort };
}
