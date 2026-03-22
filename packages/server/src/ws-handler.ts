import type { ServerWebSocket } from "bun";
import { DoughEventType } from "@dough/protocol";
import type { ClientMessage, ServerMessage } from "@dough/protocol";
import type { DoughSession } from "@dough/core";
import { DoughAgent } from "@dough/core";
import { isGitCommitCommand, appendAttributionTrailer } from "@dough/core";
import { ThreadManager } from "@dough/threads";
import type { HybridThreadStore } from "@dough/threads";
import { FileTracker } from "./file-tracker.ts";

export interface WSData {
  sessionId: string | null;
  session: DoughSession | null;
  fileTracker: FileTracker;
}

/** Tool names that write to files — we intercept these for diffing */
const FILE_WRITE_TOOLS = new Set([
  // claude-agent-sdk tool names (capitalized)
  "Write", "Edit", "MultiEdit",
  // Common lowercase variants
  "write_file", "create_file", "edit_file", "str_replace",
  "insert", "replace", "write", "patch",
]);
const FILE_DELETE_TOOLS = new Set(["delete_file", "remove_file", "rm", "Delete"]);

/**
 * Extract file path from a tool call's arguments.
 * Handles common patterns: { path }, { file_path }, { filePath }
 */
function extractFilePath(args: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "filePath", "file", "filename"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return null;
}

export function createWSHandler(agent: DoughAgent, store?: HybridThreadStore) {
  const sessions = new Map<string, DoughSession>();
  /** One FileTracker per WS connection (per session) */
  const trackers = new Map<string, FileTracker>();
  /**
   * Tracks in-flight Bash tool calls so we can inspect the command after the
   * result comes back. Keyed by callId. Cleared on response.
   */
  const pendingBashCalls = new Map<string, string>(); // callId → command string

  function getTracker(ws: ServerWebSocket<WSData>): FileTracker {
    return ws.data.fileTracker;
  }

  return {
    open(ws: ServerWebSocket<WSData>) {
      ws.data.fileTracker = new FileTracker();
      console.log("[ws] client connected");
    },

    async message(ws: ServerWebSocket<WSData>, raw: string | Buffer) {
      const msg = JSON.parse(
        typeof raw === "string" ? raw : raw.toString()
      ) as ClientMessage;

      switch (msg.kind) {
        case "create": {
          const session = await agent.session();
          await session.initialize();
          sessions.set(session.id, session);
          ws.data.sessionId = session.id;
          ws.data.session = session;

          // Persist session so it can be reconstructed after server restart
          const now = new Date().toISOString();
          store?.saveSession({
            id: session.id,
            activeThreadId: session.currentThreadId!,
            provider: msg.provider,
            model: msg.model,
            createdAt: now,
            updatedAt: now,
          });

          // Reset file tracker for new session
          getTracker(ws).reset();

          // Fetch the initial thread metadata
          const tm = agent.getThreadManager();
          const initialThreads = await tm.listThreads(session.id);
          const threadMetas = initialThreads.map((t) => ThreadManager.toMeta(t));

          const reply: ServerMessage = {
            kind: "session_info",
            session: {
              id: session.id,
              activeThreadId: session.currentThreadId!,
              threads: threadMetas,
              provider: msg.provider,
              model: msg.model,
              createdAt: now,
              updatedAt: now,
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

          const tracker = getTracker(ws);

          // Subscribe to stats changes and forward to client
          const unsubStats = tracker.onChange((stats) => {
            const statsMsg: ServerMessage = {
              kind: "event",
              event: {
                type: DoughEventType.ChangeStatsUpdate,
                stats,
              },
            };
            ws.send(JSON.stringify(statsMsg));
          });

          try {
            for await (const event of session.send(msg.prompt)) {
              // ── Bash git-commit interception (attribution) ──────────────
              // Record every Bash call so we can inspect it on completion.
              if (
                event.type === DoughEventType.ToolCallRequest &&
                event.name === "Bash" &&
                typeof event.args.command === "string"
              ) {
                pendingBashCalls.set(event.callId, event.args.command as string);
              }

              // After a Bash call completes, check if it was `git commit`.
              // If so, immediately amend HEAD to append the attribution trailer.
              if (event.type === DoughEventType.ToolCallResponse && !event.isError) {
                const bashCmd = pendingBashCalls.get(event.callId);
                if (bashCmd !== undefined) {
                  pendingBashCalls.delete(event.callId);
                  if (isGitCommitCommand(bashCmd)) {
                    await appendAttributionTrailer(agent.getCwd());
                  }
                }
              }

              // ── File write tracking (diffing) ────────────────────────────
              // Intercept tool calls that write files — snapshot before
              if (
                event.type === DoughEventType.ToolCallRequest &&
                FILE_WRITE_TOOLS.has(event.name)
              ) {
                const filePath = extractFilePath(event.args);
                if (filePath) {
                  await tracker.snapshotBefore(filePath);
                }
              }

              // After tool call completes, record the new file state
              if (
                event.type === DoughEventType.ToolCallResponse &&
                !event.isError
              ) {
                // We need the original tool call to know which file changed.
                // The session should include the file path in the response.
                // For now, re-read all snapshotted files to detect changes.
                for (const filePath of tracker["snapshots"].keys()) {
                  if (!tracker["current"].has(filePath) || true) {
                    await tracker.recordAfter(filePath);
                  }
                }
              }

              // Intercept file deletion tool calls
              if (
                event.type === DoughEventType.ToolCallRequest &&
                FILE_DELETE_TOOLS.has(event.name)
              ) {
                const filePath = extractFilePath(event.args);
                if (filePath) {
                  await tracker.recordDelete(filePath);
                }
              }

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
          } finally {
            unsubStats();
            // Update the persisted session with the latest activeThreadId
            // (may have changed due to a handoff during the exchange)
            if (store && session.currentThreadId) {
              const rec = store.loadSession(session.id);
              if (rec) {
                store.saveSession({
                  ...rec,
                  activeThreadId: session.currentThreadId,
                  updatedAt: new Date().toISOString(),
                });
              }
            }
          }
          break;
        }

        case "abort": {
          ws.data.session?.abort();
          break;
        }

        case "resume": {
          // First check live in-memory sessions
          let resumed = sessions.get(msg.sessionId);

          // Not in memory (e.g. server restarted) — try to reconstruct from DB
          if (!resumed && store) {
            const record = store.loadSession(msg.sessionId);
            if (record) {
              resumed = await agent.resumeSession(record.id, record.activeThreadId);
              sessions.set(resumed.id, resumed);
              console.log(`[ws] reconstructed session ${record.id} from db`);
            }
          }

          if (resumed) {
            ws.data.sessionId = msg.sessionId;
            ws.data.session = resumed;

            const tm = agent.getThreadManager();
            const resumedThreads = await tm.listThreads(resumed.id);
            const resumedMetas = resumedThreads.map((t) => ThreadManager.toMeta(t));
            const record = store?.loadSession(msg.sessionId);

            const reply: ServerMessage = {
              kind: "session_info",
              session: {
                id: resumed.id,
                activeThreadId: resumed.currentThreadId!,
                threads: resumedMetas,
                provider: record?.provider ?? "unknown",
                model: record?.model,
                createdAt: record?.createdAt ?? new Date().toISOString(),
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

        case "switch_thread": {
          // Resolve the target session — may differ from current
          let targetSession = ws.data.session;

          if (msg.sessionId !== ws.data.sessionId) {
            // Cross-session switch: get or reconstruct the owning session
            let found = sessions.get(msg.sessionId);
            if (!found && store) {
              const record = store.loadSession(msg.sessionId);
              if (record) {
                found = await agent.resumeSession(record.id, record.activeThreadId);
                sessions.set(found.id, found);
                console.log(`[ws] reconstructed session ${record.id} for switch_thread`);
              }
            }
            if (found) {
              targetSession = found;
              ws.data.sessionId = msg.sessionId;
              ws.data.session = targetSession;
            }
          }

          if (!targetSession) {
            const err: ServerMessage = {
              kind: "error",
              message: `Session ${msg.sessionId} not found`,
              code: "SESSION_NOT_FOUND",
            };
            ws.send(JSON.stringify(err));
            break;
          }

          // Switch active thread within the session
          targetSession.resumeThread(msg.threadId);

          // Persist the updated active thread
          if (store) {
            const rec = store.loadSession(targetSession.id);
            if (rec) {
              store.saveSession({
                ...rec,
                activeThreadId: msg.threadId,
                updatedAt: new Date().toISOString(),
              });
            }
          }

          // Send back updated session info
          const tm = agent.getThreadManager();
          const switchedThreads = await tm.listThreads(targetSession.id);
          const switchRecord = store?.loadSession(targetSession.id);
          const switchReply: ServerMessage = {
            kind: "session_info",
            session: {
              id: targetSession.id,
              activeThreadId: targetSession.currentThreadId!,
              threads: switchedThreads.map((t) => ThreadManager.toMeta(t)),
              provider: switchRecord?.provider ?? "unknown",
              model: switchRecord?.model,
              createdAt: switchRecord?.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
          ws.send(JSON.stringify(switchReply));
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
              type: DoughEventType.ThreadForked,
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

        case "get_diffs": {
          const tracker = getTracker(ws);
          const sessionId = ws.data.sessionId ?? "unknown";
          const threadId = ws.data.session?.currentThreadId ?? undefined;
          const payload = tracker.getDiffs(sessionId, threadId);
          const reply: ServerMessage = { kind: "diffs", payload };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "list_threads": {
          let threadMetas;
          if (msg.sessionId) {
            const tm = agent.getThreadManager();
            const threads = await tm.listThreads(msg.sessionId);
            threadMetas = threads.map((t) => ThreadManager.toMeta(t));
          } else {
            // No sessionId — return all threads across all sessions from the store
            const all = store ? await store.listAll() : [];
            threadMetas = all.map((t) => ({
              id: t.id,
              sessionId: t.sessionId,
              parentThreadId: t.parentThreadId,
              origin: t.origin,
              status: t.status,
              tokenCount: t.tokenCount,
              maxTokens: t.maxTokens,
              messageCount: 0, // metadata only; avoid loading all blobs
              summary: t.summary,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
            }));
          }
          const reply: ServerMessage = { kind: "threads_list", threads: threadMetas };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "list_sessions": {
          // Return metadata for all known in-memory sessions, with their threads
          const tm = agent.getThreadManager();
          const sessionMetas = await Promise.all(
            Array.from(sessions.entries()).map(async ([id, s]) => {
              const threads = await tm.listThreads(id);
              return {
                id,
                activeThreadId: s.currentThreadId ?? "unknown",
                threads: threads.map((t) => ThreadManager.toMeta(t)),
                provider: "unknown",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
            })
          );
          const reply: ServerMessage = {
            kind: "sessions_list",
            sessions: sessionMetas,
          };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "mcp_add": {
          const mcp = agent.getMcpManager();
          await mcp.add(msg.name, msg.config);
          const status = await mcp.status();
          const reply: ServerMessage = { kind: "mcp_status", servers: status };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "mcp_remove": {
          const mcp = agent.getMcpManager();
          await mcp.remove(msg.name);
          const status = await mcp.status();
          const reply: ServerMessage = { kind: "mcp_status", servers: status };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "mcp_list": {
          const mcp = agent.getMcpManager();
          const status = await mcp.status();
          const reply: ServerMessage = { kind: "mcp_status", servers: status };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "skills_list": {
          const sm = agent.getSkillManager();
          const skills = sm.status();
          const reply: ServerMessage = { kind: "skills_status", skills };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "skill_activate": {
          const sm = agent.getSkillManager();
          const skill = await sm.activate(msg.name);
          if (skill) {
            const reply: ServerMessage = {
              kind: "skill_content",
              name: skill.name,
              instructions: skill.instructions,
            };
            ws.send(JSON.stringify(reply));
          } else {
            const err: ServerMessage = {
              kind: "error",
              message: `Skill "${msg.name}" not found`,
              code: "SKILL_NOT_FOUND",
            };
            ws.send(JSON.stringify(err));
          }
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
