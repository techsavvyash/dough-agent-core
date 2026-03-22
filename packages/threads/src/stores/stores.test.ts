import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { MemoryThreadStore } from "./memory.ts";
import { SqliteThreadStore } from "./sqlite.ts";
import { JsonlThreadStore } from "./jsonl.ts";
import type { Thread, ThreadStore } from "../types.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: crypto.randomUUID(),
    sessionId: "test-session",
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
