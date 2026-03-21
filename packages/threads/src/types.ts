import type { ThreadStatus } from "@dough/protocol";

export interface Thread {
  id: string;
  sessionId: string;
  parentThreadId?: string;
  status: ThreadStatus;
  tokenCount: number;
  maxTokens: number;
  summary?: string;
  messages: ThreadMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tokenEstimate: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Pluggable storage backend for threads.
 * Implement this to persist threads however you want:
 * in-memory, SQLite, JSONL files, Redis, etc.
 */
export interface ThreadStore {
  save(thread: Thread): Promise<void>;
  load(threadId: string): Promise<Thread | null>;
  list(sessionId: string): Promise<Thread[]>;
  delete(threadId: string): Promise<void>;
}

/**
 * Pluggable token counting. Bring your own tokenizer
 * (tiktoken, claude tokenizer, simple word estimator, etc.)
 */
export interface TokenCounter {
  count(messages: ThreadMessage[]): number | Promise<number>;
}

/**
 * Pluggable summarization for thread handoff.
 * When a thread hits the token cap, SummaryGenerator produces
 * a condensed context for the new thread.
 */
export interface SummaryGenerator {
  summarize(messages: ThreadMessage[]): Promise<string>;
}

export interface ThreadManagerConfig {
  maxTokens: number;
  warningThreshold: number;
  store: ThreadStore;
  tokenCounter: TokenCounter;
  summaryGenerator: SummaryGenerator;
}

export interface HandoffResult {
  fromThread: Thread;
  toThread: Thread;
  summary: string;
}

export interface ForkResult {
  originalThread: Thread;
  forkedThread: Thread;
}
