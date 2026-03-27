import { useState, useEffect, useCallback } from "react";
import { DoughEventType } from "@dough/protocol";
import type { Attachment, DoughEvent, SessionMeta, HistoricalMessage } from "@dough/protocol";
import type { DoughClient } from "../client.ts";

export interface ToolCallEntry {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "success" | "error";
  result?: unknown;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  thought?: string;
  toolCalls?: ToolCallEntry[];
}

export function useSession(client: DoughClient) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  /** Number of messages waiting in the server queue (not yet running). */
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    const unsubEvent = client.onEvent((event: DoughEvent) => {
      switch (event.type) {
        case DoughEventType.Thought:
          setIsStreaming(true);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, thought: (last.thought ?? "") + event.text },
              ];
            }
            return [
              ...prev,
              {
                id: event.streamId,
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                isStreaming: true,
                thought: event.text,
              },
            ];
          });
          break;

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

        case DoughEventType.ToolCallRequest:
          setMessages((prev) => {
            // Find the current streaming assistant message or create one
            const last = prev[prev.length - 1];
            const entry: ToolCallEntry = {
              callId: event.callId,
              name: event.name,
              args: event.args,
              status: "pending",
            };
            if (last?.role === "assistant" && last.isStreaming) {
              const toolCalls = [...(last.toolCalls ?? []), entry];
              return [
                ...prev.slice(0, -1),
                { ...last, toolCalls },
              ];
            }
            return [
              ...prev,
              {
                id: event.streamId,
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                isStreaming: true,
                toolCalls: [entry],
              },
            ];
          });
          break;

        case DoughEventType.ToolCallResponse:
          setMessages((prev) => {
            // Find the message with this tool call and update its status
            for (let i = prev.length - 1; i >= 0; i--) {
              const msg = prev[i];
              if (!msg) continue;
              if (msg.toolCalls) {
                const idx = msg.toolCalls.findIndex(
                  (tc) => tc.callId === event.callId
                );
                if (idx >= 0) {
                  const updatedCalls = [...msg.toolCalls];
                  updatedCalls[idx] = {
                    ...updatedCalls[idx]!,
                    status: event.isError ? "error" : "success",
                    result: event.result,
                  };
                  return [
                    ...prev.slice(0, i),
                    { ...msg, toolCalls: updatedCalls },
                    ...prev.slice(i + 1),
                  ];
                }
              }
            }
            return prev;
          });
          break;

        case DoughEventType.ContextWindowWarning:
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `⚠ Context window at ${Math.round((event.usedTokens / event.maxTokens) * 100)}% — handoff will trigger soon`,
              timestamp: new Date().toISOString(),
            },
          ]);
          break;

        case DoughEventType.Finished:
          setIsStreaming(false);
          // One queued message (if any) is now starting — decrement the counter.
          setQueuedCount((prev) => Math.max(0, prev - 1));
          // Mark any remaining pending tool calls as success
          setMessages((prev) =>
            prev.map((msg) => {
              if (!msg.toolCalls?.some((tc) => tc.status === "pending"))
                return msg;
              return {
                ...msg,
                toolCalls: msg.toolCalls!.map((tc) =>
                  tc.status === "pending" ? { ...tc, status: "success" as const } : tc
                ),
              };
            })
          );
          break;

        case DoughEventType.Error:
          setIsStreaming(false);
          setError(event.message);
          break;

        case DoughEventType.Aborted:
          setIsStreaming(false);
          // Abort clears the entire server queue.
          setQueuedCount(0);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, isStreaming: false },
              ];
            }
            return prev;
          });
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

        case DoughEventType.ThreadForked:
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Thread forked: new branch created from current thread`,
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

    // Each message_queued from the server means one more prompt is waiting.
    const unsubQueue = client.onQueueUpdate(() => {
      setQueuedCount((prev) => prev + 1);
    });

    // Thread history: replace current messages with historical ones after
    // a switch_thread or resume, so the user can see the prior conversation.
    const unsubHistory = client.onThreadHistory(
      (_threadId: string, history: HistoricalMessage[]) => {
        const historical: Message[] = history.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));
        setMessages(historical);
        setError(null);
      }
    );

    return () => {
      unsubEvent();
      unsubSession();
      unsubError();
      unsubConnect();
      unsubDisconnect();
      unsubQueue();
      unsubHistory();
    };
  }, [client]);

  const send = useCallback(
    (prompt: string, attachments?: Attachment[]) => {
      const attachmentSuffix = attachments?.length
        ? `\n${attachments.map((a) => `📎 ${a.name ?? "image"}`).join("  ")}`
        : "";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: prompt + attachmentSuffix,
          timestamp: new Date().toISOString(),
        },
      ]);
      setError(null);
      client.send(prompt, undefined, attachments);
    },
    [client]
  );

  const abort = useCallback(() => {
    client.abort();
  }, [client]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "system" as const,
        content,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  return {
    messages,
    isStreaming,
    queuedCount,
    session,
    error,
    connected,
    send,
    abort,
    clearMessages,
    addSystemMessage,
  };
}
