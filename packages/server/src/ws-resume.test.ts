/**
 * WebSocket integration test: diff persistence across simulated TUI restarts.
 *
 * Starts a real Bun.serve on a random port with a mock DoughAgent.
 * Seeds the DB with a session + file diff records, then exercises the
 * full resume → ChangeStatsUpdate → get_diffs flow — exactly what the
 * TUI does on startup when it finds a saved session ID.
 *
 * No LLM calls needed; the mock agent handles session/thread stubs.
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { HybridThreadStore } from "@dough/threads";
import { DoughEventType } from "@dough/protocol";
import type { ServerMessage } from "@dough/protocol";
import { createWSHandler, type WSData } from "./ws-handler.ts";
import { FileTracker } from "./file-tracker.ts";

// ---------------------------------------------------------------------------
// Minimal mock agent — satisfies the interface createWSHandler needs
// ---------------------------------------------------------------------------

function buildMockSession(id: string, threadId: string) {
  return {
    id,
    currentThreadId: threadId,
    initialize: async () => {},
    abort: () => {},
    resumeThread: (_t: string) => {},
    send: async function* () { /* no-op */ },
  };
}

function buildMockAgent(sessionId: string, threadId: string) {
  const session = buildMockSession(sessionId, threadId);
  return {
    session: async () => session,
    resumeSession: async (id: string, tid?: string) => buildMockSession(id, tid ?? threadId),
    getThreadManager: () => ({
      listThreads: async () => [],
      getThread: async () => null,
      setThreadTitle: async () => {},
      fork: async () => ({ originalThread: { id: threadId }, forkedThread: { id: "fork-1" } }),
    }),
    getProvider: () => ({ name: "mock", sessionId: null }),
    getMcpManager: () => ({
      add: async () => {},
      remove: async () => {},
      status: async () => [],
    }),
    getSkillManager: () => ({
      status: () => [],
      activate: async () => null,
    }),
    getCwd: () => "/tmp",
    getTodoManager: () => null,
  } as unknown as import("@dough/core").DoughAgent;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let store: HybridThreadStore;
let server: ReturnType<typeof Bun.serve>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dough-ws-test-"));
  const dbPath = join(tmpDir, "test.db");
  const threadsDir = join(tmpDir, "threads");
  store = new HybridThreadStore({ dbPath, threadsDir });
});

afterEach(async () => {
  server?.stop(true);
  await rm(tmpDir, { recursive: true, force: true });
});

function startServer(sessionId: string, threadId: string): number {
  const agent = buildMockAgent(sessionId, threadId);
  const wsHandler = createWSHandler(agent, store, store);

  server = Bun.serve<WSData>({
    port: 0, // OS assigns free port
    fetch(req, srv) {
      if (new URL(req.url).pathname === "/ws") {
        const ok = srv.upgrade(req, {
          data: {
            sessionId: null,
            session: null,
            fileTracker: new FileTracker(),
            sendQueue: [] as { prompt: string; attachments?: import("@dough/protocol").Attachment[] }[],
            isProcessingQueue: false,
            pendingManualVerifications: new Map(),
          } satisfies WSData,
        });
        return ok ? undefined : new Response("upgrade failed", { status: 500 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: wsHandler,
  });

  return server.port;
}

/**
 * Connect to the server, collect ALL messages received until `done` resolves.
 * Uses addEventListener so callers can also attach their own listeners without
 * clobbering the collection handler.
 */
function collectMessages(
  port: number,
  act: (ws: WebSocket, done: () => void) => void
): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    let settled = false;

    const finish = () => {
      if (!settled) {
        settled = true;
        ws.close();
        resolve(messages);
      }
    };

    // addEventListener keeps collecting even if act() sets ws.onmessage
    ws.addEventListener("message", (e) => {
      try {
        messages.push(JSON.parse((e as MessageEvent).data as string) as ServerMessage);
      } catch { /* ignore malformed */ }
    });

    ws.onerror = () => reject(new Error("ws error"));
    ws.onopen = () => act(ws, finish);
  });
}

function send(ws: WebSocket, msg: object) {
  ws.send(JSON.stringify(msg));
}

/** Wait for a specific message kind to appear in the collected array. */
function waitFor(
  ws: WebSocket,
  kind: string,
  onMatch: () => void
): void {
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse((e as MessageEvent).data as string) as ServerMessage;
    if (msg.kind === kind) onMatch();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("resume: ChangeStatsUpdate received when file_diffs are in DB", async () => {
  const SESSION_ID = "persist-test-session";
  const THREAD_ID  = "persist-test-thread";

  await store.saveSession({
    id: SESSION_ID, activeThreadId: THREAD_ID, provider: "claude",
    model: "claude-opus-4-5",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  store.saveFileDiff({
    sessionId: SESSION_ID, filePath: "/project/src/app.ts", status: "modified",
    beforeText: "original content\n", afterText: "modified content\nnew line\n",
    unifiedDiff: "--- original\n+++ modified\n-original content\n+modified content\n+new line\n",
    linesAdded: 2, linesRemoved: 1, language: "typescript",
    updatedAt: new Date().toISOString(),
  });

  const port = startServer(SESSION_ID, THREAD_ID);

  const messages = await collectMessages(port, (ws, done) => {
    send(ws, { kind: "resume", sessionId: SESSION_ID });
    waitFor(ws, "session_info", done);
    setTimeout(done, 3000); // safety timeout
  });

  // ChangeStatsUpdate should be present
  const statsMsg = messages.find(
    (m) => m.kind === "event" &&
      (m as { kind: "event"; event: { type: string } }).event.type === DoughEventType.ChangeStatsUpdate
  ) as { kind: "event"; event: { stats: { filesChanged: number; totalAdded: number; totalRemoved: number } } } | undefined;

  expect(statsMsg).toBeDefined();
  expect(statsMsg!.event.stats.filesChanged).toBe(1);
  // updateFileStat recomputes from actual text, so check sign not exact value
  expect(statsMsg!.event.stats.totalAdded).toBeGreaterThan(0);

  // session_info must also arrive
  expect(messages.find((m) => m.kind === "session_info")).toBeDefined();

  // ChangeStatsUpdate must precede session_info in wire order
  const allKinds = messages.map((m) => m.kind === "event"
    ? `event:${(m as { kind: "event"; event: { type: string } }).event.type}`
    : m.kind
  );
  const statsIdx   = allKinds.indexOf(`event:${DoughEventType.ChangeStatsUpdate}`);
  const sessionIdx = allKinds.indexOf("session_info");
  expect(statsIdx).toBeGreaterThanOrEqual(0);
  expect(statsIdx).toBeLessThan(sessionIdx);
});

test("resume: no ChangeStatsUpdate when file_diffs table is empty", async () => {
  const SESSION_ID = "clean-session";
  const THREAD_ID  = "clean-thread";

  await store.saveSession({
    id: SESSION_ID, activeThreadId: THREAD_ID, provider: "claude",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  const port = startServer(SESSION_ID, THREAD_ID);

  const messages = await collectMessages(port, (ws, done) => {
    send(ws, { kind: "resume", sessionId: SESSION_ID });
    waitFor(ws, "session_info", done);
    setTimeout(done, 2000);
  });

  // No ChangeStatsUpdate when nothing changed
  const statsMsg = messages.find(
    (m) => m.kind === "event" &&
      (m as { kind: "event"; event: { type: string } }).event.type === DoughEventType.ChangeStatsUpdate
  );
  expect(statsMsg).toBeUndefined();

  // But session_info MUST arrive
  expect(messages.find((m) => m.kind === "session_info")).toBeDefined();
});

test("resume → get_diffs: hydrated diff payload contains correct data", async () => {
  const SESSION_ID = "getdiffs-session";
  const THREAD_ID  = "getdiffs-thread";

  await store.saveSession({
    id: SESSION_ID, activeThreadId: THREAD_ID, provider: "claude",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  store.saveFileDiff({
    sessionId: SESSION_ID, filePath: "/src/index.ts", status: "added",
    beforeText: null, afterText: "export const hello = 'world';\n",
    unifiedDiff: "+++ /src/index.ts\n+export const hello = 'world';\n",
    linesAdded: 1, linesRemoved: 0, language: "typescript",
    updatedAt: new Date().toISOString(),
  });

  const port = startServer(SESSION_ID, THREAD_ID);

  const messages = await collectMessages(port, (ws, done) => {
    send(ws, { kind: "resume", sessionId: SESSION_ID });

    // Once session_info arrives, fire get_diffs; close after diffs response
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse((e as MessageEvent).data as string) as ServerMessage;
      if (msg.kind === "session_info") {
        send(ws, { kind: "get_diffs" });
      }
      if (msg.kind === "diffs") {
        done();
      }
    });

    setTimeout(done, 3000);
  });

  type DiffsMsg = {
    kind: "diffs";
    payload: { diffs: Array<{ filePath: string; status: string; afterText?: string; beforeText?: string }> };
  };

  const diffsMsg = messages.find((m) => m.kind === "diffs") as DiffsMsg | undefined;

  expect(diffsMsg).toBeDefined();
  expect(diffsMsg!.payload.diffs).toHaveLength(1);
  expect(diffsMsg!.payload.diffs[0]!.filePath).toBe("/src/index.ts");
  expect(diffsMsg!.payload.diffs[0]!.status).toBe("added");
  // beforeText: null → "" in getDiffs
  expect(diffsMsg!.payload.diffs[0]!.beforeText).toBe("");
  expect(diffsMsg!.payload.diffs[0]!.afterText).toBe("export const hello = 'world';\n");
});

test("resume: multiple file diffs all hydrate — correct count and wire order", async () => {
  const SESSION_ID = "multi-diff-session";
  const THREAD_ID  = "multi-diff-thread";

  await store.saveSession({
    id: SESSION_ID, activeThreadId: THREAD_ID, provider: "claude",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  // Note: updateFileStat recomputes from before/after text on hydrate,
  // so use consistent before/after for predictable line counts.
  const files = [
    { filePath: "/src/a.ts", status: "modified" as const, before: "before\n", after: "after\n" },
    { filePath: "/src/b.ts", status: "added"    as const, before: null,       after: "new\n"   },
    { filePath: "/src/c.ts", status: "deleted"  as const, before: "old\n",    after: null      },
  ];

  for (const f of files) {
    store.saveFileDiff({
      sessionId: SESSION_ID, filePath: f.filePath, status: f.status,
      beforeText: f.before, afterText: f.after,
      unifiedDiff: "diff", linesAdded: 1, linesRemoved: 1,
      updatedAt: new Date().toISOString(),
    });
  }

  const port = startServer(SESSION_ID, THREAD_ID);

  const messages = await collectMessages(port, (ws, done) => {
    send(ws, { kind: "resume", sessionId: SESSION_ID });
    waitFor(ws, "session_info", done);
    setTimeout(done, 3000);
  });

  type StatsMsg = {
    kind: "event";
    event: { type: string; stats: { filesChanged: number; totalAdded: number; totalRemoved: number } };
  };

  const statsMsg = messages.find(
    (m) => m.kind === "event" &&
      (m as StatsMsg).event.type === DoughEventType.ChangeStatsUpdate
  ) as StatsMsg | undefined;

  expect(statsMsg).toBeDefined();
  // 3 files → 3 entries in statsCache
  expect(statsMsg!.event.stats.filesChanged).toBe(3);
  // Computed from actual text:
  //  a.ts modified: "before\n" → "after\n" = +1/-1
  //  b.ts added:    null       → "new\n"   = +1/-0
  //  c.ts deleted:  "old\n"    → null      = +0/-1
  expect(statsMsg!.event.stats.totalAdded).toBe(2);    // 1+1+0
  expect(statsMsg!.event.stats.totalRemoved).toBe(2);  // 1+0+1
});

test("SESSION_NOT_FOUND error when session not in DB", async () => {
  const port = startServer("irrelevant", "irrelevant");

  const messages = await collectMessages(port, (ws, done) => {
    send(ws, { kind: "resume", sessionId: "ghost-session" });

    ws.addEventListener("message", (e) => {
      const msg = JSON.parse((e as MessageEvent).data as string) as ServerMessage;
      if (msg.kind === "error") done();
    });

    setTimeout(done, 1500);
  });

  const errMsg = messages.find((m) => m.kind === "error") as
    | { kind: "error"; code?: string; message: string }
    | undefined;

  expect(errMsg).toBeDefined();
  expect(errMsg!.code).toBe("SESSION_NOT_FOUND");
});
