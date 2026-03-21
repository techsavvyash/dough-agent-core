import type { ServerWebSocket } from "bun";
import type { ClientMessage, ServerMessage } from "@dough/protocol";
import type { DoughSession } from "@dough/core";
import type { DoughAgent } from "@dough/core";

export interface WSData {
  sessionId: string | null;
  session: DoughSession | null;
}

export function createWSHandler(agent: DoughAgent) {
  const sessions = new Map<string, DoughSession>();

  return {
    open(ws: ServerWebSocket<WSData>) {
      console.log("[ws] client connected");
    },

    async message(ws: ServerWebSocket<WSData>, raw: string | Buffer) {
      const msg = JSON.parse(
        typeof raw === "string" ? raw : raw.toString()
      ) as ClientMessage;

      switch (msg.kind) {
        case "create": {
          const session = agent.session();
          await session.initialize();
          sessions.set(session.id, session);
          ws.data.sessionId = session.id;
          ws.data.session = session;

          const reply: ServerMessage = {
            kind: "session_info",
            session: {
              id: session.id,
              activeThreadId: session.currentThreadId!,
              threads: [],
              provider: msg.provider,
              model: msg.model,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "send": {
          const session = ws.data.session;
          if (!session) {
            const err: ServerMessage = {
              kind: "error",
              message: "No active session. Send a 'create' message first.",
              code: "NO_SESSION",
            };
            ws.send(JSON.stringify(err));
            return;
          }

          try {
            for await (const event of session.send(msg.prompt)) {
              const reply: ServerMessage = { kind: "event", event };
              ws.send(JSON.stringify(reply));
            }
          } catch (error) {
            const err: ServerMessage = {
              kind: "error",
              message:
                error instanceof Error ? error.message : "Unknown error",
            };
            ws.send(JSON.stringify(err));
          }
          break;
        }

        case "abort": {
          ws.data.session?.abort();
          break;
        }

        case "resume": {
          const existing = sessions.get(msg.sessionId);
          if (existing) {
            ws.data.sessionId = msg.sessionId;
            ws.data.session = existing;
            const reply: ServerMessage = {
              kind: "session_info",
              session: {
                id: existing.id,
                activeThreadId: existing.currentThreadId!,
                threads: [],
                provider: "unknown",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            };
            ws.send(JSON.stringify(reply));
          } else {
            const err: ServerMessage = {
              kind: "error",
              message: `Session ${msg.sessionId} not found`,
              code: "SESSION_NOT_FOUND",
            };
            ws.send(JSON.stringify(err));
          }
          break;
        }

        case "fork": {
          const session = ws.data.session;
          if (!session) return;
          const tm = agent.getThreadManager();
          const result = await tm.fork(msg.threadId, msg.forkPoint);
          const reply: ServerMessage = {
            kind: "event",
            event: {
              type: "thread_forked" as const,
              fromThreadId: result.originalThread.id,
              newThreadId: result.forkedThread.id,
              reason: msg.forkPoint
                ? `Forked at ${msg.forkPoint}`
                : "Full fork",
            },
          };
          ws.send(JSON.stringify(reply));
          break;
        }

        default: {
          const err: ServerMessage = {
            kind: "error",
            message: `Unknown message kind: ${(msg as { kind: string }).kind}`,
          };
          ws.send(JSON.stringify(err));
        }
      }
    },

    close(ws: ServerWebSocket<WSData>) {
      console.log("[ws] client disconnected");
    },
  };
}
