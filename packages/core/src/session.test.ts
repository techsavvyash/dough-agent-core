import { test, expect, describe } from "bun:test";
import { DoughEventType } from "@dough/protocol";
import type { DoughEvent } from "@dough/protocol";
import { ThreadManager, MemoryThreadStore } from "@dough/threads";
import type { ThreadMessage, TokenCounter, SummaryGenerator } from "@dough/threads";
import { DoughSession } from "./session.ts";
import type { LLMProvider, SendOptions } from "./providers/provider.ts";

// ── Test helpers ─────────────────────────────────────────────

/** Token counter that uses the tokenEstimate field directly */
const counter: TokenCounter = {
  count(messages: ThreadMessage[]): number {
    return messages.reduce((sum, m) => sum + m.tokenEstimate, 0);
  },
};

const summarizer: SummaryGenerator = {
  async summarize(messages: ThreadMessage[]): Promise<string> {
    return `Summary of ${messages.length} messages`;
  },
};

/**
 * Fake LLM provider that returns a canned response.
 * responseTokens controls how many tokens the response costs (via content length).
 */
function createFakeProvider(
  responseText: string = "Hello!",
  responseTokens?: number
): LLMProvider {
  return {
    name: "fake",
    maxContextTokens: 200_000,

    async *send(
      _messages: ThreadMessage[],
      _options: SendOptions
    ): AsyncGenerator<DoughEvent> {
      const streamId = crypto.randomUUID();
      yield {
        type: DoughEventType.ContentDelta,
        text: responseText,
        streamId,
      };
      yield {
        type: DoughEventType.ContentComplete,
        text: responseText,
        usage: {
          inputTokens: 100,
          outputTokens: responseTokens ?? Math.ceil(responseText.length / 4),
          totalTokens: 100 + (responseTokens ?? Math.ceil(responseText.length / 4)),
        },
        streamId,
      };
      yield {
        type: DoughEventType.Finished,
        reason: "completed",
      };
    },

    estimateTokens(messages: ThreadMessage[]): number {
      return messages.reduce((sum, m) => sum + m.tokenEstimate, 0);
    },
  };
}

function createSession(
  maxTokens: number,
  provider?: LLMProvider,
): { session: DoughSession; tm: ThreadManager } {
  const tm = new ThreadManager(
    ThreadManager.createConfig({
      maxTokens,
      store: new MemoryThreadStore(),
      tokenCounter: counter,
      summaryGenerator: summarizer,
    })
  );

  const session = new DoughSession(crypto.randomUUID(), {
    provider: provider ?? createFakeProvider(),
    threadManager: tm,
  });

  return { session, tm };
}

async function collectEvents(gen: AsyncGenerator<DoughEvent>): Promise<DoughEvent[]> {
  const events: DoughEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

// ── Tests ────────────────────────────────────────────────────

describe("DoughSession — token limit enforcement", () => {

  test("basic send works under limit", async () => {
    const { session } = createSession(10_000);
    const events = await collectEvents(session.send("hi"));

    const deltas = events.filter(e => e.type === DoughEventType.ContentDelta);
    expect(deltas.length).toBeGreaterThan(0);

    // No handoff should occur
    const handoffs = events.filter(e => e.type === DoughEventType.ThreadHandoff);
    expect(handoffs).toHaveLength(0);
  });

  test("user message + assistant response are both stored in thread", async () => {
    const { session, tm } = createSession(10_000);
    await session.initialize();
    const threadId = session.currentThreadId!;

    await collectEvents(session.send("hello"));

    const thread = await tm.getThread(threadId);
    expect(thread!.messages).toHaveLength(2); // user + assistant
    expect(thread!.messages[0].role).toBe("user");
    expect(thread!.messages[1].role).toBe("assistant");
  });

  test("handoff triggers when tokens exceed max AFTER user message", async () => {
    // maxTokens = 500. We'll fill the thread close to the limit,
    // then send a message that pushes it over.
    const { session, tm } = createSession(500);
    await session.initialize();
    const originalThreadId = session.currentThreadId!;

    // Manually fill the thread to just under the limit (490 tokens)
    // by adding messages directly through ThreadManager
    await tm.addMessage(originalThreadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "previous question",
      tokenEstimate: 240,
      timestamp: new Date().toISOString(),
    });
    await tm.addMessage(originalThreadId, {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "previous answer",
      tokenEstimate: 240,
      timestamp: new Date().toISOString(),
    });

    // Thread now at 480 tokens. Next user message (with ~25 tokens from "push me over")
    // will bring it to ~486, still under 500.
    // But with the fix, re-fetching the thread after addMessage should see the true count.
    // Let's use a bigger message to clearly cross the threshold.
    const events = await collectEvents(session.send("a".repeat(100))); // ~25 tokens

    const handoffs = events.filter(e => e.type === DoughEventType.ThreadHandoff);
    expect(handoffs).toHaveLength(1);

    // The session should now be on a new thread
    expect(session.currentThreadId).not.toBe(originalThreadId);
  });

  test("handoff creates new thread with summary as system message", async () => {
    const { session, tm } = createSession(300);
    await session.initialize();
    const originalThreadId = session.currentThreadId!;

    // Fill to capacity
    await tm.addMessage(originalThreadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "big prompt",
      tokenEstimate: 298,
      timestamp: new Date().toISOString(),
    });

    // This send should trigger handoff (298 + ceil(15/4)=4 = 302 > 300)
    await collectEvents(session.send("trigger handoff"));

    const newThreadId = session.currentThreadId!;
    expect(newThreadId).not.toBe(originalThreadId);

    const newThread = await tm.getThread(newThreadId);
    expect(newThread).not.toBeNull();
    // The new thread should have: summary (system) + user message + assistant response
    // Or at minimum: summary (system) + assistant response (if user message went to old thread)
    const systemMsgs = newThread!.messages.filter(m => m.role === "system");
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
    expect(systemMsgs[0].content).toContain("Summary");
  });

  test("old thread is archived after handoff", async () => {
    const { session, tm } = createSession(300);
    await session.initialize();
    const originalThreadId = session.currentThreadId!;

    await tm.addMessage(originalThreadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "fill",
      tokenEstimate: 299,
      timestamp: new Date().toISOString(),
    });

    await collectEvents(session.send("trigger"));

    const oldThread = await tm.getThread(originalThreadId);
    expect(oldThread!.status).toBe("full");
    expect(oldThread!.summary).toBeTruthy();
  });

  test("warning event is emitted at 90% threshold", async () => {
    const { session, tm } = createSession(1000); // warning at 900
    await session.initialize();
    const threadId = session.currentThreadId!;

    const tmEvents: DoughEvent[] = [];
    tm.on(e => tmEvents.push(e));

    // Add message that crosses warning threshold but not max
    await tm.addMessage(threadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "big",
      tokenEstimate: 910,
      timestamp: new Date().toISOString(),
    });

    const warnings = tmEvents.filter(
      e => e.type === DoughEventType.ContextWindowWarning
    );
    expect(warnings).toHaveLength(1);
  });

  test("multiple handoffs chain threads correctly", async () => {
    const { session, tm } = createSession(200);
    await session.initialize();
    const firstThreadId = session.currentThreadId!;

    // Fill first thread to just under limit
    await tm.addMessage(firstThreadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "fill",
      tokenEstimate: 198,
      timestamp: new Date().toISOString(),
    });

    // First handoff (198 + ceil(10/4)=3 = 201 > 200)
    await collectEvents(session.send("handoff 1"));
    const secondThreadId = session.currentThreadId!;
    expect(secondThreadId).not.toBe(firstThreadId);

    // Fill second thread to just under limit
    await tm.addMessage(secondThreadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "fill again",
      tokenEstimate: 198,
      timestamp: new Date().toISOString(),
    });

    // Second handoff
    await collectEvents(session.send("handoff 2"));
    const thirdThreadId = session.currentThreadId!;
    expect(thirdThreadId).not.toBe(secondThreadId);

    // Verify chain: third → second → first
    const chain = await tm.getThreadChain(thirdThreadId);
    expect(chain).toHaveLength(3);
    expect(chain[0].id).toBe(thirdThreadId);
    expect(chain[1].id).toBe(secondThreadId);
    expect(chain[2].id).toBe(firstThreadId);

    // First two should be archived
    expect(chain[1].status).toBe("full");
    expect(chain[2].status).toBe("full");
    // Current should be active
    expect(chain[0].status).toBe("active");
  });

  test("cannot add messages to archived thread", async () => {
    const { session, tm } = createSession(200);
    await session.initialize();
    const threadId = session.currentThreadId!;

    await tm.addMessage(threadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "fill",
      tokenEstimate: 200,
      timestamp: new Date().toISOString(),
    });

    await tm.handoff(threadId);

    // Trying to add to the archived thread should throw
    expect(
      tm.addMessage(threadId, {
        id: crypto.randomUUID(),
        role: "user",
        content: "should fail",
        tokenEstimate: 10,
        timestamp: new Date().toISOString(),
      })
    ).rejects.toThrow("full");
  });

  test("handoff preserves session ID across threads", async () => {
    const { session, tm } = createSession(200);
    await session.initialize();
    const originalThreadId = session.currentThreadId!;

    const original = await tm.getThread(originalThreadId);
    const sessionId = original!.sessionId;

    await tm.addMessage(originalThreadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "fill",
      tokenEstimate: 200,
      timestamp: new Date().toISOString(),
    });

    await collectEvents(session.send("trigger"));

    const newThread = await tm.getThread(session.currentThreadId!);
    expect(newThread!.sessionId).toBe(sessionId);
  });

  test("needsHandoff uses fresh token count after addMessage", async () => {
    // This test specifically targets the stale-data bug:
    // needsHandoff must check the UPDATED thread, not a stale copy.
    const { session, tm: _tm } = createSession(100);
    await session.initialize();
    const threadId = session.currentThreadId!;

    // Send a message whose tokens alone exceed the limit
    // The user message "x".repeat(500) → tokenEstimate = ceil(500/4) = 125 > 100
    const events = await collectEvents(session.send("x".repeat(500)));

    const handoffs = events.filter(e => e.type === DoughEventType.ThreadHandoff);
    // The handoff MUST trigger because the user message alone exceeds 100 tokens
    expect(handoffs).toHaveLength(1);
    expect(session.currentThreadId).not.toBe(threadId);
  });

  test("assistant response is stored on the correct thread after handoff", async () => {
    const { session, tm } = createSession(100, createFakeProvider("response text"));
    await session.initialize();
    const originalThreadId = session.currentThreadId!;

    // Fill to capacity so handoff triggers on next send (99 + ceil(15/4)=4 = 103 > 100)
    await tm.addMessage(originalThreadId, {
      id: crypto.randomUUID(),
      role: "user",
      content: "fill",
      tokenEstimate: 99,
      timestamp: new Date().toISOString(),
    });

    await collectEvents(session.send("trigger handoff"));

    const newThreadId = session.currentThreadId!;
    expect(newThreadId).not.toBe(originalThreadId);

    const newThread = await tm.getThread(newThreadId);
    // New thread should have the assistant's response stored
    const assistantMsgs = newThread!.messages.filter(m => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    expect(assistantMsgs[0].content).toBe("response text");
  });

  test("abort stops streaming and yields Aborted event", async () => {
    // Create a slow provider that we can abort mid-stream
    const slowProvider: LLMProvider = {
      name: "slow",
      maxContextTokens: 200_000,
      async *send(_messages, _options): AsyncGenerator<DoughEvent> {
        const streamId = crypto.randomUUID();
        yield { type: DoughEventType.ContentDelta, text: "part1 ", streamId };
        // Check abort after first delta
        if (_options.signal?.aborted) return;
        yield { type: DoughEventType.ContentDelta, text: "part2", streamId };
      },
      estimateTokens(messages) {
        return messages.reduce((s, m) => s + m.tokenEstimate, 0);
      },
    };

    const { session } = createSession(10_000, slowProvider);
    await session.initialize();

    // Start sending, collect first event, then abort
    const events: DoughEvent[] = [];
    const gen = session.send("hello");

    for await (const event of gen) {
      events.push(event);
      if (events.length === 1) {
        session.abort();
      }
    }

    const aborted = events.filter(e => e.type === DoughEventType.Aborted);
    expect(aborted).toHaveLength(1);
  });
});
