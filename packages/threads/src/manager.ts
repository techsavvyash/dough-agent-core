import { DoughEventType } from "@dough/protocol";
import type { DoughEvent } from "@dough/protocol";
import type {
  Thread,
  ThreadMessage,
  ThreadManagerConfig,
  HandoffResult,
  ForkResult,
} from "./types.ts";

const DEFAULT_MAX_TOKENS = 200_000;
const DEFAULT_WARNING_RATIO = 0.9;

type ThreadEventHandler = (event: DoughEvent) => void;

export class ThreadManager {
  private config: ThreadManagerConfig;
  private listeners: Set<ThreadEventHandler> = new Set();

  constructor(config: ThreadManagerConfig) {
    this.config = config;
  }

  get maxTokens(): number {
    return this.config.maxTokens;
  }

  get warningThreshold(): number {
    return this.config.warningThreshold;
  }

  on(handler: ThreadEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(event: DoughEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  async createThread(sessionId: string): Promise<Thread> {
    const thread: Thread = {
      id: crypto.randomUUID(),
      sessionId,
      origin: "root",
      status: "active",
      tokenCount: 0,
      maxTokens: this.config.maxTokens,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.config.store.save(thread);
    return thread;
  }

  async getThread(threadId: string): Promise<Thread | null> {
    return this.config.store.load(threadId);
  }

  async listThreads(sessionId: string): Promise<Thread[]> {
    return this.config.store.list(sessionId);
  }

  async addMessage(threadId: string, message: ThreadMessage): Promise<void> {
    const thread = await this.config.store.load(threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);
    if (thread.status !== "active")
      throw new Error(`Thread ${threadId} is ${thread.status}, cannot add messages`);

    thread.messages.push(message);
    thread.tokenCount = await this.config.tokenCounter.count(thread.messages);
    thread.updatedAt = new Date().toISOString();
    await this.config.store.save(thread);

    // Check warning threshold
    if (thread.tokenCount >= this.config.warningThreshold) {
      this.emit({
        type: DoughEventType.ContextWindowWarning,
        threadId: thread.id,
        usedTokens: thread.tokenCount,
        maxTokens: thread.maxTokens,
      });
    }
  }

  /**
   * Check if a thread needs handoff (approaching or exceeding token cap).
   */
  needsHandoff(thread: Thread): boolean {
    return thread.tokenCount >= this.config.maxTokens;
  }

  /**
   * Perform a thread handoff: summarize the current thread,
   * create a new one with the summary as initial context.
   */
  async handoff(threadId: string): Promise<HandoffResult> {
    const fromThread = await this.config.store.load(threadId);
    if (!fromThread) throw new Error(`Thread ${threadId} not found`);

    const summary = await this.config.summaryGenerator.summarize(
      fromThread.messages
    );

    // Archive the old thread
    fromThread.status = "full";
    fromThread.summary = summary;
    fromThread.updatedAt = new Date().toISOString();
    await this.config.store.save(fromThread);

    // Create new thread with summary as initial context
    const toThread: Thread = {
      id: crypto.randomUUID(),
      sessionId: fromThread.sessionId,
      parentThreadId: fromThread.id,
      origin: "handoff",
      status: "active",
      tokenCount: 0,
      maxTokens: this.config.maxTokens,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `Previous thread summary:\n\n${summary}`,
          tokenEstimate: 0,
          timestamp: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Count tokens for the summary message
    toThread.tokenCount = await this.config.tokenCounter.count(
      toThread.messages
    );
    toThread.messages[0]!.tokenEstimate = toThread.tokenCount;
    await this.config.store.save(toThread);

    this.emit({
      type: DoughEventType.ThreadHandoff,
      fromThreadId: fromThread.id,
      toThreadId: toThread.id,
      summary,
    });

    return { fromThread, toThread, summary };
  }

  /**
   * Fork a thread: create a new branch from a specific point in the conversation.
   */
  async fork(threadId: string, forkPoint?: string): Promise<ForkResult> {
    const originalThread = await this.config.store.load(threadId);
    if (!originalThread) throw new Error(`Thread ${threadId} not found`);

    let messages: ThreadMessage[];
    if (forkPoint) {
      const idx = originalThread.messages.findIndex((m) => m.id === forkPoint);
      if (idx === -1)
        throw new Error(`Fork point ${forkPoint} not found in thread`);
      messages = originalThread.messages.slice(0, idx + 1);
    } else {
      messages = [...originalThread.messages];
    }

    const forkedThread: Thread = {
      id: crypto.randomUUID(),
      sessionId: originalThread.sessionId,
      parentThreadId: originalThread.id,
      origin: "fork",
      status: "active",
      tokenCount: 0,
      maxTokens: this.config.maxTokens,
      messages: messages.map((m) => ({ ...m })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    forkedThread.tokenCount = await this.config.tokenCounter.count(
      forkedThread.messages
    );
    await this.config.store.save(forkedThread);

    this.emit({
      type: DoughEventType.ThreadForked,
      fromThreadId: originalThread.id,
      newThreadId: forkedThread.id,
      reason: forkPoint ? `Forked at message ${forkPoint}` : "Full fork",
    });

    return { originalThread, forkedThread };
  }

  /**
   * Walk the parent chain from a thread back to the root.
   * Returns threads ordered newest → oldest.
   */
  async getThreadChain(threadId: string): Promise<Thread[]> {
    const chain: Thread[] = [];
    let currentId: string | undefined = threadId;

    while (currentId) {
      const thread = await this.config.store.load(currentId);
      if (!thread) break;
      chain.push(thread);
      currentId = thread.parentThreadId;
    }

    return chain;
  }

  /**
   * Delete all threads for a session.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const threads = await this.config.store.list(sessionId);
    for (const thread of threads) {
      await this.config.store.delete(thread.id);
    }
  }

  /**
   * Convert a Thread to wire-safe ThreadMeta (strips messages).
   */
  static toMeta(thread: Thread): import("@dough/protocol").ThreadMeta {
    return {
      id: thread.id,
      sessionId: thread.sessionId,
      parentThreadId: thread.parentThreadId,
      origin: thread.origin,
      status: thread.status,
      tokenCount: thread.tokenCount,
      maxTokens: thread.maxTokens,
      messageCount: thread.messages.length,
      summary: thread.summary,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    };
  }

  /**
   * Create a default config with sensible defaults.
   * Requires a store, token counter, and summary generator.
   */
  static createConfig(
    overrides: Partial<ThreadManagerConfig> & {
      store: ThreadManagerConfig["store"];
      tokenCounter: ThreadManagerConfig["tokenCounter"];
      summaryGenerator: ThreadManagerConfig["summaryGenerator"];
    }
  ): ThreadManagerConfig {
    return {
      maxTokens: overrides.maxTokens ?? DEFAULT_MAX_TOKENS,
      warningThreshold:
        overrides.warningThreshold ??
        Math.floor((overrides.maxTokens ?? DEFAULT_MAX_TOKENS) * DEFAULT_WARNING_RATIO),
      store: overrides.store,
      tokenCounter: overrides.tokenCounter,
      summaryGenerator: overrides.summaryGenerator,
    };
  }
}
