import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { MemoryThreadStore } from "./memory.ts";
import { SqliteThreadStore } from "./sqlite.ts";
import { JsonlThreadStore } from "./jsonl.ts";
import { HybridThreadStore } from "./hybrid.ts";
import type { Thread, ThreadStore, SessionRecord } from "../types.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: crypto.randomUUID(),
    sessionId: "test-session",
    origin: "root",
    status: "active",
    tokenCount: 0,
    maxTokens: 200_000,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function storeTests(name: string, createStore: () => Promise<{ store: ThreadStore; cleanup: () => Promise<void> }>) {
  describe(name, () => {
    let store: ThreadStore;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const result = await createStore();
      store = result.store;
      cleanup = result.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    test("save and load a thread", async () => {
      const thread = makeThread();
      await store.save(thread);
      const loaded = await store.load(thread.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(thread.id);
      expect(loaded!.sessionId).toBe(thread.sessionId);
      expect(loaded!.status).toBe("active");
    });

    test("load returns null for non-existent thread", async () => {
      const loaded = await store.load("nonexistent");
      expect(loaded).toBeNull();
    });

    test("save overwrites existing thread", async () => {
      const thread = makeThread();
      await store.save(thread);

      thread.status = "full";
      thread.summary = "was full";
      await store.save(thread);

      const loaded = await store.load(thread.id);
      expect(loaded!.status).toBe("full");
      expect(loaded!.summary).toBe("was full");
    });

    test("save and load with messages", async () => {
      const thread = makeThread({
        messages: [
          {
            id: "m1",
            role: "user",
            content: "hello",
            tokenEstimate: 10,
            timestamp: new Date().toISOString(),
          },
          {
            id: "m2",
            role: "assistant",
            content: "hi there",
            tokenEstimate: 15,
            timestamp: new Date().toISOString(),
          },
        ],
        tokenCount: 25,
      });
      await store.save(thread);
      const loaded = await store.load(thread.id);
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.messages[0].content).toBe("hello");
      expect(loaded!.messages[1].content).toBe("hi there");
      expect(loaded!.tokenCount).toBe(25);
    });

    test("list returns threads for a session", async () => {
      await store.save(makeThread({ sessionId: "s1" }));
      await store.save(makeThread({ sessionId: "s1" }));
      await store.save(makeThread({ sessionId: "s2" }));

      const s1 = await store.list("s1");
      const s2 = await store.list("s2");
      expect(s1).toHaveLength(2);
      expect(s2).toHaveLength(1);
    });

    test("list returns empty for unknown session", async () => {
      const result = await store.list("nonexistent");
      expect(result).toHaveLength(0);
    });

    test("delete removes a thread", async () => {
      const thread = makeThread();
      await store.save(thread);
      await store.delete(thread.id);
      const loaded = await store.load(thread.id);
      expect(loaded).toBeNull();
    });

    test("delete is safe for non-existent thread", async () => {
      await store.delete("nonexistent"); // should not throw
    });

    test("preserves parentThreadId", async () => {
      const parent = makeThread();
      const child = makeThread({ parentThreadId: parent.id });
      await store.save(parent);
      await store.save(child);

      const loaded = await store.load(child.id);
      expect(loaded!.parentThreadId).toBe(parent.id);
    });

    test("preserves message metadata", async () => {
      const thread = makeThread({
        messages: [
          {
            id: "m1",
            role: "user",
            content: "test",
            tokenEstimate: 5,
            timestamp: new Date().toISOString(),
            metadata: { source: "cli", edited: true },
          },
        ],
      });
      await store.save(thread);
      const loaded = await store.load(thread.id);
      expect(loaded!.messages[0].metadata).toEqual({
        source: "cli",
        edited: true,
      });
    });

    // ── Session tests ───────────────────────────────────────────

    test("saveSession and loadSession", async () => {
      const rec: SessionRecord = {
        id: "sess-1",
        activeThreadId: "t-1",
        provider: "claude",
        model: "sonnet",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await store.saveSession(rec);
      const loaded = await store.loadSession("sess-1");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("sess-1");
      expect(loaded!.activeThreadId).toBe("t-1");
      expect(loaded!.provider).toBe("claude");
      expect(loaded!.model).toBe("sonnet");
    });

    test("loadSession returns null for unknown id", async () => {
      const loaded = await store.loadSession("nonexistent");
      expect(loaded).toBeNull();
    });

    test("saveSession upserts", async () => {
      const now = new Date().toISOString();
      await store.saveSession({
        id: "sess-1",
        activeThreadId: "t-1",
        provider: "claude",
        createdAt: now,
        updatedAt: now,
      });
      await store.saveSession({
        id: "sess-1",
        activeThreadId: "t-2",
        provider: "claude",
        providerSessionId: "sdk-123",
        createdAt: now,
        updatedAt: new Date().toISOString(),
      });
      const loaded = await store.loadSession("sess-1");
      expect(loaded!.activeThreadId).toBe("t-2");
      expect(loaded!.providerSessionId).toBe("sdk-123");
    });

    test("listSessions returns all, newest first", async () => {
      await store.saveSession({
        id: "sess-old",
        activeThreadId: "t-1",
        provider: "claude",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      await store.saveSession({
        id: "sess-new",
        activeThreadId: "t-2",
        provider: "codex",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
      });
      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe("sess-new");
      expect(sessions[1].id).toBe("sess-old");
    });

    test("listAll returns thread metadata with messageCount", async () => {
      await store.save(
        makeThread({
          sessionId: "s1",
          messages: [
            { id: "m1", role: "user", content: "a", tokenEstimate: 1, timestamp: new Date().toISOString() },
            { id: "m2", role: "assistant", content: "b", tokenEstimate: 1, timestamp: new Date().toISOString() },
          ],
          tokenCount: 2,
        })
      );
      await store.save(makeThread({ sessionId: "s2" }));

      const all = await store.listAll();
      expect(all).toHaveLength(2);
      const withMessages = all.find((t) => t.sessionId === "s1");
      const empty = all.find((t) => t.sessionId === "s2");
      expect(withMessages!.messageCount).toBe(2);
      expect(empty!.messageCount).toBe(0);
      // Should not have a messages property
      expect("messages" in withMessages!).toBe(false);
    });
  });
}

// Run the same test suite against all three stores

storeTests("MemoryThreadStore", async () => ({
  store: new MemoryThreadStore(),
  cleanup: async () => {},
}));

storeTests("SqliteThreadStore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dough-sqlite-test-"));
  const dbPath = join(dir, "test.db");
  const store = new SqliteThreadStore(dbPath);
  return {
    store,
    cleanup: async () => {
      (store as SqliteThreadStore).close();
      await rm(dir, { recursive: true, force: true });
    },
  };
});

storeTests("JsonlThreadStore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dough-jsonl-test-"));
  const store = new JsonlThreadStore(dir);
  return {
    store,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
});

storeTests("HybridThreadStore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dough-hybrid-test-"));
  const store = new HybridThreadStore({
    dbPath: join(dir, "test.db"),
    threadsDir: join(dir, "threads"),
  });
  return {
    store,
    cleanup: async () => {
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
});
