import type { ServerWebSocket } from "bun";
import { DoughEventType } from "@dough/protocol";
import type {
  Attachment,
  ClientMessage,
  ServerMessage,
  HistoricalToolCall,
  RuntimeShortcutMeta,
  RuntimeCommandMeta,
  RuntimePanelMeta,
} from "@dough/protocol";
import { getModelsForProvider, getDefaultModelForProvider } from "@dough/protocol";
import type { DoughSession } from "@dough/core";
import { DoughAgent } from "@dough/core";
import type { DiffCheckpointExtensionInstance } from "@dough/core";
import { ThreadManager } from "@dough/threads";
import type { ThreadStore, FileDiffRecord } from "@dough/threads";
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

/**
 * Serialize runtime commands/shortcuts/panels into protocol-safe meta objects.
 */
function getContributions(agent: DoughAgent): {
  shortcuts: RuntimeShortcutMeta[];
  commands: RuntimeCommandMeta[];
  panels: RuntimePanelMeta[];
} {
  const runtime = agent.getRuntime();
  return {
    shortcuts: runtime.getShortcuts().map((s) => ({
      id: s.id,
      key: s.key,
      description: s.description,
      commandId: s.commandId,
    })),
    commands: runtime.getCommands().map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      category: c.category,
    })),
    panels: runtime.getPanels().map((p) => ({
      id: p.id,
      name: p.name,
      mode: p.mode,
    })),
  };
}

/**
 * Flush any pending runtime UI intents to the client.
 */
function flushRuntimeIntents(ws: ServerWebSocket<WSData>, agent: DoughAgent): void {
  const runtime = agent.getRuntime();

  // Drain notifications
  for (const notif of runtime.drainNotifications()) {
    const msg: ServerMessage = {
      kind: "runtime:notify",
      message: notif.message,
      level: notif.level,
    };
    ws.send(JSON.stringify(msg));
  }

  // Drain panel open intents
  for (const intent of runtime.drainPanelOpenIntents()) {
    const msg: ServerMessage = {
      kind: "runtime:open_panel",
      panelId: intent.panelId,
      data: intent.data,
    };
    ws.send(JSON.stringify(msg));
  }

  // Status updates
  const status = runtime.getStatus();
  if (status.size > 0) {
    const entries: Record<string, string> = {};
    for (const [k, v] of status) entries[k] = v;
    const msg: ServerMessage = { kind: "runtime:status", entries };
    ws.send(JSON.stringify(msg));
  }
}

export function createWSHandler(agent: DoughAgent, store?: ThreadStore, diffStore?: FileDiffStore) {
  const sessions = new Map<string, DoughSession>();

  /** Get the diff-checkpoint extension's FileTracker (single instance, shared across connections). */
  function getDiffTracker() {
    const ext = agent.getRuntime().getExtension<DiffCheckpointExtensionInstance>("diff-checkpoint");
    return ext?.getTracker() ?? null;
  }

  /** Send current runtime contributions to the client. Called on open and
   *  after create/resume (runtime may not be initialized at open time). */
  function sendContributions(ws: ServerWebSocket<WSData>): void {
    const { shortcuts, commands, panels } = getContributions(agent);
    ws.send(JSON.stringify({ kind: "runtime:shortcuts", shortcuts } as ServerMessage));
    ws.send(JSON.stringify({ kind: "runtime:commands", commands } as ServerMessage));
    ws.send(JSON.stringify({ kind: "runtime:panels", panels } as ServerMessage));
  }

  // ── Command side-effects ────────────────────────────────────────────────────

  /**
   * Handle server-side operations for runtime commands that need access to
   * agent/session/store. Called after the extension's execute() has run and
   * UI intents have been flushed.
   */
  async function handleCommandSideEffects(
    ws: ServerWebSocket<WSData>,
    commandId: string,
    args?: Record<string, unknown>,
  ): Promise<void> {
    switch (commandId) {
      // Palette shortcuts delegate to the generic provider_switch handler
      case "session.provider_claude":
        return handleCommandSideEffects(ws, "session.provider_switch", { provider: "claude" });
      case "session.provider_codex":
        return handleCommandSideEffects(ws, "session.provider_switch", { provider: "codex" });

      case "session.provider_switch": {
        const target = String(args?.provider ?? "").toLowerCase();
        if (target !== "claude" && target !== "codex") {
          const err: ServerMessage = {
            kind: "error",
            message: `Invalid provider "${target}". Use "claude" or "codex".`,
          };
          ws.send(JSON.stringify(err));
          return;
        }

        const currentProvider = agent.getProvider().name;
        if (currentProvider === target) {
          const notify: ServerMessage = {
            kind: "runtime:notify",
            message: `Already using ${target}.`,
            level: "info",
          };
          ws.send(JSON.stringify(notify));
          return;
        }

        // Create new provider and hot-swap it
        const newProvider = agent.createProvider(target);
        agent.setProvider(newProvider);

        // Reset model to the new provider's default
        const defaultModel = getDefaultModelForProvider(target);
        const newModelId = defaultModel?.id;
        if (newModelId) {
          agent.setModel(newModelId);
        }

        // Update the active session's provider and model references
        if (ws.data.session) {
          ws.data.session.setProvider(newProvider);
          if (newModelId) ws.data.session.setModel(newModelId);
        }

        // Send updated session_info so the TUI updates its provider display
        const session = ws.data.session;
        if (session) {
          const tm = agent.getThreadManager();
          const threads = await tm.listThreads(session.id);
          const reply: ServerMessage = {
            kind: "session_info",
            session: {
              id: session.id,
              activeThreadId: session.currentThreadId!,
              threads: threads.map((t) => ThreadManager.toMeta(t)),
              provider: target,
              model: newModelId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          };
          ws.send(JSON.stringify(reply));
        }

        console.log(`[ws] provider switched: ${currentProvider} → ${target}`);
        break;
      }

      case "session.thread_fork": {
        const session = ws.data.session;
        if (!session?.currentThreadId) return;
        const tm = agent.getThreadManager();
        const result = await tm.fork(session.currentThreadId);
        const reply: ServerMessage = {
          kind: "event",
          event: {
            type: DoughEventType.ThreadForked,
            fromThreadId: result.originalThread.id,
            newThreadId: result.forkedThread.id,
            reason: "Full fork",
          },
        };
        ws.send(JSON.stringify(reply));
        break;
      }

      case "session.thread_new": {
        const newSession = await agent.session();
        await newSession.initialize();
        sessions.set(newSession.id, newSession);
        ws.data.sessionId = newSession.id;
        ws.data.session = newSession;

        const runtime = agent.getRuntime();
        runtime.setSession(newSession.id, newSession.currentThreadId!);
        await runtime.emit({
          type: "session:start",
          sessionId: newSession.id,
          threadId: newSession.currentThreadId!,
        });

        const now = new Date().toISOString();
        const providerName = agent.getProvider().name;
        await store?.saveSession({
          id: newSession.id,
          activeThreadId: newSession.currentThreadId!,
          provider: providerName,
          createdAt: now,
          updatedAt: now,
        });

        const tm = agent.getThreadManager();
        const threads = await tm.listThreads(newSession.id);
        const reply: ServerMessage = {
          kind: "session_info",
          session: {
            id: newSession.id,
            activeThreadId: newSession.currentThreadId!,
            threads: threads.map((t) => ThreadManager.toMeta(t)),
            provider: providerName,
            createdAt: now,
            updatedAt: now,
          },
        };
        ws.send(JSON.stringify(reply));
        sendContributions(ws);
        break;
      }

      case "session.compact": {
        if (ws.data.session) {
          ws.data.sendQueue.push({ prompt: "/compact" });
          drainQueue(ws);
        }
        break;
      }
    }
  }

  // ── Send-queue helpers ──────────────────────────────────────────────────────

  /**
   * Run one full agent turn for `prompt` on `session`, streaming all events
   * back over `ws`. Platform events (tool:call, tool:result, etc.) are now
   * emitted by DoughSession through the PlatformRuntime's event bus —
   * extensions handle attribution, diff tracking, etc. automatically.
   */
  async function processOneSend(
    ws: ServerWebSocket<WSData>,
    session: DoughSession,
    prompt: string,
    attachments?: Attachment[]
  ): Promise<void> {
    const tracker = getDiffTracker();
    const unsubStats = tracker?.onChange((stats) => {
      const statsMsg: ServerMessage = {
        kind: "event",
        event: { type: DoughEventType.ChangeStatsUpdate, stats },
      };
      ws.send(JSON.stringify(statsMsg));
    });

    try {
      for await (const event of session.send(prompt, attachments)) {
        // Platform events (attribution, diff tracking) are handled by
        // extensions via the runtime event bus in DoughSession.send().
        // We just relay DoughEvents to the client.
        ws.send(JSON.stringify({ kind: "event", event } as ServerMessage));

        // Flush any runtime notifications/intents generated by extensions
        flushRuntimeIntents(ws, agent);
      }
    } catch (error) {
      const err: ServerMessage = {
        kind: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      };
      ws.send(JSON.stringify(err));
    } finally {
      unsubStats?.();

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

      // Final flush of any remaining intents
      flushRuntimeIntents(ws, agent);
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

      // Configure persistence on the diff-checkpoint extension's shared tracker
      const tracker = getDiffTracker();
      if (tracker && persistence) {
        tracker.setPersistence(persistence);
      }

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

      // Send runtime contributions (may be empty if runtime not yet initialized —
      // resent after create/resume when runtime is guaranteed ready)
      sendContributions(ws);

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

          // Update runtime session state
          const runtime = agent.getRuntime();
          runtime.setSession(session.id, session.currentThreadId!);
          await runtime.emit({ type: "session:start", sessionId: session.id, threadId: session.currentThreadId! });

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

          // Runtime is now initialized — resend contributions
          sendContributions(ws);
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

            // Update runtime session state and emit resume event
            const runtime = agent.getRuntime();
            runtime.setSession(resumed.id, resumed.currentThreadId!);
            await runtime.emit({ type: "session:resume", sessionId: resumed.id, threadId: resumed.currentThreadId! });

            // Push ChangeStatsUpdate immediately so the TUI badge lights up without
            // requiring the user to run another prompt first
            const hydratedStats = getDiffTracker()?.getStats() ?? { filesChanged: 0, totalAdded: 0, totalRemoved: 0, files: [] };
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

            // Runtime is now initialized — resend contributions
            sendContributions(ws);

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

          // Update runtime session state
          agent.getRuntime().setSession(targetSession.id, msg.threadId);

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
          const ext = agent.getRuntime().getExtension<DiffCheckpointExtensionInstance>("diff-checkpoint");
          const sessionId = ws.data.sessionId ?? "unknown";
          const threadId = ws.data.session?.currentThreadId ?? undefined;
          const payload = ext
            ? ext.getDiffs(sessionId, threadId)
            : { sessionId, threadId, diffs: [], stats: { filesChanged: 0, totalAdded: 0, totalRemoved: 0, files: [] } };
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

        // ── Model switching ─────────────────────────────────────────

        case "switch_model": {
          const targetModel = msg.model;
          const currentProvider = agent.getProvider().name;
          const validModels = getModelsForProvider(currentProvider);

          if (!validModels.find((m) => m.id === targetModel)) {
            const err: ServerMessage = {
              kind: "error",
              message: `Model "${targetModel}" is not available for provider "${currentProvider}".`,
            };
            ws.send(JSON.stringify(err));
            break;
          }

          // Update model on both agent config and active session
          agent.setModel(targetModel);
          if (ws.data.session) {
            ws.data.session.setModel(targetModel);
          }

          // Send updated session_info so the TUI updates its model display
          const session = ws.data.session;
          if (session) {
            const tm = agent.getThreadManager();
            const threads = await tm.listThreads(session.id);
            const reply: ServerMessage = {
              kind: "session_info",
              session: {
                id: session.id,
                activeThreadId: session.currentThreadId!,
                threads: threads.map((t) => ThreadManager.toMeta(t)),
                provider: currentProvider,
                model: targetModel,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            };
            ws.send(JSON.stringify(reply));
          }

          // Persist updated model
          if (store && session) {
            const rec = await store.loadSession(session.id);
            if (rec) {
              await store.saveSession({
                ...rec,
                model: targetModel,
                updatedAt: new Date().toISOString(),
              });
            }
          }

          console.log(`[ws] model switched to ${targetModel} (provider: ${currentProvider})`);
          break;
        }

        // ── Runtime messages ────────────────────────────────────────

        case "runtime:get_contributions": {
          sendContributions(ws);
          break;
        }

        case "runtime:shortcut_triggered": {
          const runtime = agent.getRuntime();
          await runtime.emit({ type: "ui:shortcut", shortcutId: msg.shortcutId });

          // Find the command linked to this shortcut and execute it
          const shortcut = runtime.getShortcuts().find((s) => s.id === msg.shortcutId);
          if (shortcut) {
            const cmd = runtime.getCommand(shortcut.commandId);
            if (cmd) {
              await cmd.execute({
                sessionId: ws.data.sessionId ?? "",
                activeThreadId: ws.data.session?.currentThreadId ?? "",
                runtime,
              });
            }
          }

          flushRuntimeIntents(ws, agent);
          break;
        }

        case "runtime:command": {
          const runtime = agent.getRuntime();
          await runtime.emit({ type: "ui:command", commandId: msg.commandId, args: msg.args });

          const cmd = runtime.getCommand(msg.commandId);
          if (cmd) {
            await cmd.execute({
              sessionId: ws.data.sessionId ?? "",
              activeThreadId: ws.data.session?.currentThreadId ?? "",
              runtime,
            });
          }

          flushRuntimeIntents(ws, agent);

          // Server-side effects for commands that need access to the
          // agent/session/store — the extension handles UI intents (notify,
          // openPanel) but these operations require server-level access.
          await handleCommandSideEffects(ws, msg.commandId, msg.args);
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
