import { test, expect, beforeEach, describe } from "bun:test";
import { ThreadManager } from "./manager.ts";
import { MemoryThreadStore } from "./stores/memory.ts";
import type {
  ThreadMessage,
  TokenCounter,
  SummaryGenerator,
  ThreadManagerConfig,
} from "./types.ts";
import { DoughEventType } from "@dough/protocol";

function makeMessage(
  role: ThreadMessage["role"],
  content: string,
  tokens: number = 100
): ThreadMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    tokenEstimate: tokens,
    timestamp: new Date().toISOString(),
  };
}

const counter: TokenCounter = {
  count(messages) {
    return messages.reduce((sum, m) => sum + m.tokenEstimate, 0);
  },
};

const summarizer: SummaryGenerator = {
  async summarize(messages) {
    return `Summary of ${messages.length} messages`;
  },
};

function createManager(maxTokens = 1000): ThreadManager {
  const config = ThreadManager.createConfig({
    maxTokens,
    store: new MemoryThreadStore(),
    tokenCounter: counter,
    summaryGenerator: summarizer,
  });
  return new ThreadManager(config);
}

describe("ThreadManager", () => {
  describe("createThread", () => {
    test("creates a thread with UUID and active status", async () => {
      const tm = createManager();
      const thread = await tm.createThread("session-1");
      expect(thread.id).toBeTruthy();
      expect(thread.sessionId).toBe("session-1");
      expect(thread.status).toBe("active");
      expect(thread.tokenCount).toBe(0);
      expect(thread.messages).toHaveLength(0);
    });

    test("persists thread to store", async () => {
      const tm = createManager();
      const thread = await tm.createThread("session-1");
      const loaded = await tm.getThread(thread.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(thread.id);
    });
  });

  describe("addMessage", () => {
    test("adds message and updates token count", async () => {
      const tm = createManager();
      const thread = await tm.createThread("s1");
      const msg = makeMessage("user", "hello", 50);
      await tm.addMessage(thread.id, msg);

      const updated = await tm.getThread(thread.id);
      expect(updated!.messages).toHaveLength(1);
      expect(updated!.tokenCount).toBe(50);
    });

    test("accumulates multiple messages", async () => {
      const tm = createManager();
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "q1", 100));
      await tm.addMessage(thread.id, makeMessage("assistant", "a1", 200));
      await tm.addMessage(thread.id, makeMessage("user", "q2", 150));

      const updated = await tm.getThread(thread.id);
      expect(updated!.messages).toHaveLength(3);
      expect(updated!.tokenCount).toBe(450);
    });

    test("throws on non-existent thread", async () => {
      const tm = createManager();
      expect(
        tm.addMessage("fake-id", makeMessage("user", "hi"))
      ).rejects.toThrow("not found");
    });

    test("throws on non-active thread", async () => {
      const tm = createManager(200);
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "fill", 250));
      // handoff archives the thread
      await tm.handoff(thread.id);

      expect(
        tm.addMessage(thread.id, makeMessage("user", "more"))
      ).rejects.toThrow("full");
    });

    test("emits ContextWindowWarning at threshold", async () => {
      const tm = createManager(1000); // warning at 900
      const thread = await tm.createThread("s1");
      const events: any[] = [];
      tm.on((e) => events.push(e));

      await tm.addMessage(thread.id, makeMessage("user", "big", 950));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(DoughEventType.ContextWindowWarning);
      expect(events[0].usedTokens).toBe(950);
    });

    test("does not emit warning below threshold", async () => {
      const tm = createManager(1000);
      const thread = await tm.createThread("s1");
      const events: any[] = [];
      tm.on((e) => events.push(e));

      await tm.addMessage(thread.id, makeMessage("user", "small", 100));
      expect(events).toHaveLength(0);
    });
  });

  describe("needsHandoff", () => {
    test("false when under limit", async () => {
      const tm = createManager(1000);
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "hi", 500));
      const loaded = await tm.getThread(thread.id);
      expect(tm.needsHandoff(loaded!)).toBe(false);
    });

    test("true when at or over limit", async () => {
      const tm = createManager(1000);
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "big", 1000));
      const loaded = await tm.getThread(thread.id);
      expect(tm.needsHandoff(loaded!)).toBe(true);
    });
  });

  describe("handoff", () => {
    test("archives old thread and creates new one with summary", async () => {
      const tm = createManager(500);
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "q1", 300));
      await tm.addMessage(thread.id, makeMessage("assistant", "a1", 250));

      const result = await tm.handoff(thread.id);

      // Old thread archived
      expect(result.fromThread.status).toBe("full");
      expect(result.fromThread.summary).toBeTruthy();

      // New thread created with summary
      expect(result.toThread.status).toBe("active");
      expect(result.toThread.parentThreadId).toBe(thread.id);
      expect(result.toThread.sessionId).toBe("s1");
      expect(result.toThread.messages).toHaveLength(1);
      expect(result.toThread.messages[0].role).toBe("system");
      expect(result.toThread.messages[0].content).toContain("Summary");
    });

    test("emits ThreadHandoff event", async () => {
      const tm = createManager(500);
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "q", 600));

      const events: any[] = [];
      tm.on((e) => events.push(e));
      await tm.handoff(thread.id);

      const handoffEvent = events.find(
        (e) => e.type === DoughEventType.ThreadHandoff
      );
      expect(handoffEvent).toBeTruthy();
      expect(handoffEvent.fromThreadId).toBe(thread.id);
      expect(handoffEvent.toThreadId).toBeTruthy();
    });

    test("new thread is persisted and retrievable", async () => {
      const tm = createManager(500);
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "q", 600));

      const result = await tm.handoff(thread.id);
      const newThread = await tm.getThread(result.toThread.id);
      expect(newThread).not.toBeNull();
      expect(newThread!.status).toBe("active");
    });
  });

  describe("fork", () => {
    test("full fork copies all messages", async () => {
      const tm = createManager();
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "q1", 100));
      await tm.addMessage(thread.id, makeMessage("assistant", "a1", 200));
      await tm.addMessage(thread.id, makeMessage("user", "q2", 100));

      const result = await tm.fork(thread.id);

      expect(result.forkedThread.messages).toHaveLength(3);
      expect(result.forkedThread.parentThreadId).toBe(thread.id);
      expect(result.forkedThread.sessionId).toBe("s1");
      expect(result.forkedThread.tokenCount).toBe(400);
    });

    test("fork at specific point truncates messages", async () => {
      const tm = createManager();
      const thread = await tm.createThread("s1");
      const msg1 = makeMessage("user", "q1", 100);
      const msg2 = makeMessage("assistant", "a1", 200);
      const msg3 = makeMessage("user", "q2", 100);
      await tm.addMessage(thread.id, msg1);
      await tm.addMessage(thread.id, msg2);
      await tm.addMessage(thread.id, msg3);

      const result = await tm.fork(thread.id, msg2.id);

      expect(result.forkedThread.messages).toHaveLength(2);
      expect(result.forkedThread.messages[1].id).toBe(msg2.id);
    });

    test("fork does not modify original thread", async () => {
      const tm = createManager();
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "q", 100));
      await tm.addMessage(thread.id, makeMessage("assistant", "a", 200));

      await tm.fork(thread.id);

      const original = await tm.getThread(thread.id);
      expect(original!.messages).toHaveLength(2);
      expect(original!.status).toBe("active");
    });

    test("emits ThreadForked event", async () => {
      const tm = createManager();
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "q", 100));

      const events: any[] = [];
      tm.on((e) => events.push(e));
      await tm.fork(thread.id);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(DoughEventType.ThreadForked);
    });

    test("throws on invalid fork point", async () => {
      const tm = createManager();
      const thread = await tm.createThread("s1");
      await tm.addMessage(thread.id, makeMessage("user", "q", 100));

      expect(tm.fork(thread.id, "nonexistent")).rejects.toThrow(
        "Fork point"
      );
    });
  });

  describe("listThreads", () => {
    test("lists threads for a session", async () => {
      const tm = createManager();
      await tm.createThread("s1");
      await tm.createThread("s1");
      await tm.createThread("s2");

      const s1Threads = await tm.listThreads("s1");
      const s2Threads = await tm.listThreads("s2");

      expect(s1Threads).toHaveLength(2);
      expect(s2Threads).toHaveLength(1);
    });
  });

  describe("event listener", () => {
    test("on() returns unsubscribe function", async () => {
      const tm = createManager(100);
      const thread = await tm.createThread("s1");
      const events: any[] = [];
      const unsub = tm.on((e) => events.push(e));

      await tm.addMessage(thread.id, makeMessage("user", "a", 95));
      expect(events).toHaveLength(1);

      unsub();
      // Create new thread since old one might be at capacity
      const thread2 = await tm.createThread("s2");
      await tm.addMessage(thread2.id, makeMessage("user", "b", 95));
      expect(events).toHaveLength(1); // no new events after unsub
    });
  });

  describe("thread tree navigation", () => {
    test("getThreadChain returns parent chain from newest to oldest", async () => {
      const tm = createManager(200);
      const t1 = await tm.createThread("s1");
      await tm.addMessage(t1.id, makeMessage("user", "fill", 250));
      const r1 = await tm.handoff(t1.id);

      await tm.addMessage(r1.toThread.id, makeMessage("user", "fill2", 250));
      const r2 = await tm.handoff(r1.toThread.id);

      const chain = await tm.getThreadChain(r2.toThread.id);
      expect(chain).toHaveLength(3);
      expect(chain[0].id).toBe(r2.toThread.id);
      expect(chain[1].id).toBe(r1.toThread.id);
      expect(chain[2].id).toBe(t1.id);
    });
  });

  describe("deleteSession", () => {
    test("removes all threads for a session", async () => {
      const tm = createManager();
      await tm.createThread("s1");
      await tm.createThread("s1");
      await tm.createThread("s2");

      await tm.deleteSession("s1");

      const s1 = await tm.listThreads("s1");
      const s2 = await tm.listThreads("s2");
      expect(s1).toHaveLength(0);
      expect(s2).toHaveLength(1);
    });
  });
});
