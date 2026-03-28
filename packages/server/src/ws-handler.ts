import type { ServerWebSocket } from "bun";
import { DoughEventType } from "@dough/protocol";
import type { Attachment, ClientMessage, ServerMessage, HistoricalToolCall } from "@dough/protocol";
import type { DoughSession } from "@dough/core";
import { DoughAgent } from "@dough/core";
import { appendAttributionTrailer, isGitCommitCommand } from "@dough/core";
import type { TodoManager } from "@dough/core";
import { ThreadManager } from "@dough/threads";
import type { ThreadStore, FileDiffRecord } from "@dough/threads";
import { FileTracker } from "./file-tracker.ts";
import type { FileTrackerPersistence } from "./file-tracker.ts";

/**
 * Narrow interface for diff persistence — implemented by HybridThreadStore.
 * Defined here so ws-handler doesn't need to import the concrete store class.
 */
export interface FileDiffStore {
  saveFileDiff(record: FileDiffRecord): void;
  loadFileDiffs(sessionId: string): FileDiffRecord[];
  clearFileDiffs(sessionId: string): void;
}

export interface WSData {
  sessionId: string | null;
  session: DoughSession | null;
  fileTracker: FileTracker;
  /** Prompts (+ optional attachments) waiting to run once the current agent turn completes. */
  sendQueue: { prompt: string; attachments?: Attachment[] }[];
  /** True while drainQueue() is iterating; prevents concurrent drains. */
  isProcessingQueue: boolean;
  /** Pending manual todo verifications: todoId → resolve(approved) */
  pendingManualVerifications: Map<string, (approved: boolean) => void>;
  /** Unsubscribe function for the TodoManager onChange listener */
  unsubTodos?: () => void;
}

/**
 * Derive a short display title from a user prompt.
 * Takes the first non-empty line, capped at 60 chars.
 */
function deriveTitle(prompt: string): string {
  const firstLine = prompt.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? prompt.trim();
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
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

export function createWSHandler(agent: DoughAgent, store?: ThreadStore, diffStore?: FileDiffStore) {
  const sessions = new Map<string, DoughSession>();
  /**
   * Tracks in-flight Bash tool calls so we can inspect the command after the
   * result comes back. Keyed by callId. Cleared on response.
   */
  const pendingBashCalls = new Map<string, string>(); // callId → command string

  // ── Send-queue helpers ──────────────────────────────────────────────────────

  /**
   * Run one full agent turn for `prompt` on `session`, streaming all events
   * back over `ws`. Extracted so drainQueue() can call it serially.
   */
  async function processOneSend(
    ws: ServerWebSocket<WSData>,
    session: DoughSession,
    prompt: string,
    attachments?: Attachment[]
  ): Promise<void> {
    const tracker = ws.data.fileTracker;

    const unsubStats = tracker.onChange((stats) => {
      const statsMsg: ServerMessage = {
        kind: "event",
        event: { type: DoughEventType.ChangeStatsUpdate, stats },
      };
      ws.send(JSON.stringify(statsMsg));
    });

    try {
      for await (const event of session.send(prompt, attachments)) {
        // ── Attribution fallback ─────────────────────────────────────
        // The primary attribution mechanism is a ToolMiddleware applied at
        // the DoughAgent level (createAttributionMiddleware in core), which
        // fires BEFORE execution via the provider's PreToolUse hook and injects
        // `--trailer` directly into the git commit command.
        //
        // This post-hoc amend is a safety net for edge cases where the hook
        // couldn't fire: --amend commits, providers without hook support, etc.
        if (
          event.type === DoughEventType.ToolCallRequest &&
          event.name === "Bash" &&
          typeof event.args.command === "string"
        ) {
          pendingBashCalls.set(event.callId, event.args.command as string);
        }

        if (event.type === DoughEventType.ToolCallResponse && !event.isError) {
          const bashCmd = pendingBashCalls.get(event.callId);
          if (bashCmd !== undefined) {
            pendingBashCalls.delete(event.callId);
            // Skip --amend commands (avoid double-amending the primary hook's work)
            if (isGitCommitCommand(bashCmd) && !/--amend\b/.test(bashCmd)) {
              await appendAttributionTrailer(agent.getCwd());
            }
          }
        }

        // ── File write tracking (diffing) ────────────────────────────
        if (
          event.type === DoughEventType.ToolCallRequest &&
          FILE_WRITE_TOOLS.has(event.name)
        ) {
          const filePath = extractFilePath(event.args);
          if (filePath) await tracker.snapshotBefore(filePath);
        }

        if (
          event.type === DoughEventType.ToolCallResponse &&
          !event.isError
        ) {
          for (const filePath of tracker["snapshots"].keys()) {
            await tracker.recordAfter(filePath);
          }
        }

        if (
          event.type === DoughEventType.ToolCallRequest &&
          FILE_DELETE_TOOLS.has(event.name)
        ) {
          const filePath = extractFilePath(event.args);
          if (filePath) await tracker.recordDelete(filePath);
        }

        ws.send(JSON.stringify({ kind: "event", event } as ServerMessage));
      }
    } catch (error) {
      const err: ServerMessage = {
        kind: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      ws.send(JSON.stringify(err));
    } finally {
      unsubStats();

      if (session.currentThreadId) {
        // Set a short display title from the first user prompt if not already set.
        // No-op when a handoff summary already exists.
        await agent.getThreadManager()
          .setThreadTitle(session.currentThreadId, deriveTitle(prompt));
      }

      if (store && session.currentThreadId) {
        const rec = await store.loadSession(session.id);
        if (rec) {
          // Also persist the provider-native session ID so it can be
          // restored after a server restart (gives the SDK full history).
          const providerSessionId =
            agent.getProvider().sessionId ?? rec.providerSessionId;
          await store.saveSession({
            ...rec,
            activeThreadId: session.currentThreadId,
            providerSessionId,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  /**
   * Drain ws.data.sendQueue serially — one turn at a time.
   * Fire-and-forget: call without await from the message handler.
   * The isProcessingQueue flag ensures only one drain loop runs per connection.
   */
  async function drainQueue(ws: ServerWebSocket<WSData>): Promise<void> {
    if (ws.data.isProcessingQueue) return;
    ws.data.isProcessingQueue = true;

    while (ws.data.sendQueue.length > 0) {
      const session = ws.data.session;
      if (!session) break;
      const item = ws.data.sendQueue.shift()!;
      await processOneSend(ws, session, item.prompt, item.attachments);
    }

    ws.data.isProcessingQueue = false;
  }

  // ── Thread history helper ───────────────────────────────────────────────────

  /**
   * Load a thread from the store and send its messages to the client as a
   * `thread_history` message.  Called after switch_thread and resume so the
   * TUI can display prior conversation without waiting for a new turn.
   */
  async function sendThreadHistory(
    ws: ServerWebSocket<WSData>,
    threadId: string
  ): Promise<void> {
    const tm = agent.getThreadManager();
    const thread = await tm.getThread(threadId);
    if (!thread || thread.messages.length === 0) return;

    const reply: ServerMessage = {
      kind: "thread_history",
      threadId,
      messages: thread.messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.metadata?.toolCalls as HistoricalToolCall[] | undefined,
      })),
    };
    ws.send(JSON.stringify(reply));
  }

  // ── WebSocket handler ───────────────────────────────────────────────────────

  return {
    open(ws: ServerWebSocket<WSData>) {
      // Build the persistence adapter that bridges FileTracker ↔ FileDiffStore.
      // Defined here so it closes over the `diffStore` from createWSHandler.
      const persistence: FileTrackerPersistence | undefined = diffStore
        ? {
            save(sessionId, filePath, beforeText, afterText, diff) {
              diffStore.saveFileDiff({
                sessionId,
                filePath,
                status: diff.status,
                beforeText,
                afterText,
                unifiedDiff: diff.unifiedDiff,
                linesAdded: diff.linesAdded,
                linesRemoved: diff.linesRemoved,
                language: diff.language,
                updatedAt: new Date().toISOString(),
              });
            },
            load(sessionId) {
              return diffStore.loadFileDiffs(sessionId).map((r) => ({
                filePath: r.filePath,
                beforeText: r.beforeText,
                afterText: r.afterText,
                diff: {
                  filePath: r.filePath,
                  status: r.status,
                  unifiedDiff: r.unifiedDiff,
                  linesAdded: r.linesAdded,
                  linesRemoved: r.linesRemoved,
                  language: r.language,
                },
              }));
            },
            clear(sessionId) {
              diffStore.clearFileDiffs(sessionId);
            },
          }
        : undefined;

      ws.data.fileTracker = new FileTracker({ persistence });
      ws.data.sendQueue = [];
      ws.data.isProcessingQueue = false;
      ws.data.pendingManualVerifications = new Map();

      // Set up todo change listener for push notifications
      const todoMgr = agent.getTodoManager();
      if (todoMgr) {
        ws.data.unsubTodos = todoMgr.onChange((todos, sessionId) => {
          if (sessionId === ws.data.sessionId) {
            const pushMsg: ServerMessage = { kind: "todos_update", todos };
            ws.send(JSON.stringify(pushMsg));
          }
        });
      }

      console.log(`[ws] client connected (diffStore=${!!diffStore}, persistence=${!!persistence})`);
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
          await store?.saveSession({
            id: session.id,
            activeThreadId: session.currentThreadId!,
            provider: msg.provider,
            model: msg.model,
            createdAt: now,
            updatedAt: now,
          });

          // Reset file tracker for new session and bind it to the new session ID
          ws.data.fileTracker.reset();
          ws.data.fileTracker.setSessionId(session.id);

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

          // Enqueue the prompt. If something is already running, notify the
          // client that this message is queued and will run when the current
          // turn completes. drainQueue() is idempotent — safe to call every time.
          ws.data.sendQueue.push({ prompt: msg.prompt, attachments: msg.attachments });
          const position = ws.data.sendQueue.length;

          if (position > 1) {
            const queued: ServerMessage = { kind: "message_queued", position };
            ws.send(JSON.stringify(queued));
          }

          drainQueue(ws); // fire-and-forget — serialises automatically via isProcessingQueue
          break;
        }

        case "abort": {
          // Clear pending queue first so no new turns start after the abort.
          ws.data.sendQueue = [];
          ws.data.session?.abort();
          break;
        }

        case "resume": {
          // First check live in-memory sessions
          let resumed = sessions.get(msg.sessionId);

          // Not in memory (e.g. server restarted) — try to reconstruct from DB
          if (!resumed && store) {
            const record = await store.loadSession(msg.sessionId);
            if (record) {
              resumed = await agent.resumeSession(
                record.id,
                record.activeThreadId,
                record.providerSessionId
              );
              sessions.set(resumed.id, resumed);
              console.log(`[ws] reconstructed session ${record.id} from db`);
            }
          }

          if (resumed) {
            ws.data.sessionId = msg.sessionId;
            ws.data.session = resumed;

            // Hydrate file tracker from persisted diffs so Ctrl+D works after restart
            ws.data.fileTracker.setSessionId(msg.sessionId);
            ws.data.fileTracker.hydrate(msg.sessionId);

            // Push ChangeStatsUpdate immediately so the TUI badge lights up without
            // requiring the user to run another prompt first
            const hydratedStats = ws.data.fileTracker.getStats();
            console.log(`[ws] resume hydrated stats: filesChanged=${hydratedStats.filesChanged} +${hydratedStats.totalAdded}/-${hydratedStats.totalRemoved}`);
            if (hydratedStats.filesChanged > 0) {
              const statsMsg: ServerMessage = {
                kind: "event",
                event: { type: DoughEventType.ChangeStatsUpdate, stats: hydratedStats },
              };
              ws.send(JSON.stringify(statsMsg));
            }

            const tm = agent.getThreadManager();
            const resumedThreads = await tm.listThreads(resumed.id);
            const resumedMetas = resumedThreads.map((t) => ThreadManager.toMeta(t));
            const record = await store?.loadSession(msg.sessionId);

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

            // Send thread history so the TUI can populate the message panel
            if (resumed.currentThreadId) {
              await sendThreadHistory(ws, resumed.currentThreadId);
            }
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
              const record = await store.loadSession(msg.sessionId);
              if (record) {
                found = await agent.resumeSession(
                  record.id,
                  record.activeThreadId,
                  record.providerSessionId
                );
                sessions.set(found.id, found);
                console.log(`[ws] reconstructed session ${record.id} for switch_thread`);
              } else {
                // Session predates persistence (no SQLite record). Reconstruct
                // a minimal session directly from the sessionId + target thread.
                found = await agent.resumeSession(msg.sessionId, msg.threadId);
                sessions.set(found.id, found);
                console.log(`[ws] ghost-reconstructed session ${msg.sessionId} for switch_thread`);
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
            const rec = await store.loadSession(targetSession.id);
            if (rec) {
              await store.saveSession({
                ...rec,
                activeThreadId: msg.threadId,
                updatedAt: new Date().toISOString(),
              });
            }
          }

          // Send back updated session info
          const tm = agent.getThreadManager();
          const switchedThreads = await tm.listThreads(targetSession.id);
          const switchRecord = await store?.loadSession(targetSession.id);
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

          // Send thread history so the TUI shows the prior conversation
          if (targetSession.currentThreadId) {
            await sendThreadHistory(ws, targetSession.currentThreadId);
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
          const tracker = ws.data.fileTracker;
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
            // No sessionId — return all threads across all sessions from the store.
            // listAll() now includes real messageCount from JSONL line counts.
            const all = store ? await store.listAll() : [];
            threadMetas = all.map((t) => ({
              id: t.id,
              sessionId: t.sessionId,
              parentThreadId: t.parentThreadId,
              origin: t.origin,
              status: t.status,
              tokenCount: t.tokenCount,
              maxTokens: t.maxTokens,
              messageCount: t.messageCount,
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

        case "todos_list": {
          const tm = agent.getTodoManager();
          if (!tm) {
            const err: ServerMessage = { kind: "error", message: "Todos feature not enabled", code: "TODOS_DISABLED" };
            ws.send(JSON.stringify(err));
            break;
          }
          const todos = await tm.read({}, msg.sessionId);
          const reply: ServerMessage = { kind: "todos_update", todos };
          ws.send(JSON.stringify(reply));
          break;
        }

        case "todo_verify": {
          const resolver = ws.data.pendingManualVerifications.get(msg.todoId);
          if (resolver) {
            resolver(msg.approved);
            ws.data.pendingManualVerifications.delete(msg.todoId);
          }
          const tm = agent.getTodoManager();
          if (tm && ws.data.sessionId) {
            // Finalize the verification in the store
            await tm.finalizeManualVerification(msg.todoId, msg.approved);
            const todos = await tm.read({}, ws.data.sessionId);
            const pushMsg: ServerMessage = { kind: "todos_update", todos };
            ws.send(JSON.stringify(pushMsg));
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
      ws.data.unsubTodos?.();
      console.log("[ws] client disconnected");
    },
  };
}
