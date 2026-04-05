import type { ThreadStatus, ThreadOrigin } from "@dough/protocol";

export interface Thread {
  id: string;
  sessionId: string;
  parentThreadId?: string;
  /** How this thread was created: root (first), handoff (context overflow), fork (user branched) */
  origin: ThreadOrigin;
  status: ThreadStatus;
  tokenCount: number;
  maxTokens: number;
  /** Cumulative actual LLM usage (input + output tokens consumed). Persisted. */
  tokensUsed: number;
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

/** Persisted session record — enough to reconstruct a DoughSession after restart. */
export interface SessionRecord {
  id: string;
  activeThreadId: string;
  provider: string;
  model?: string;
  /** Provider-native session ID (e.g. claude-agent-sdk's session_id). */
  providerSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Thread metadata without messages, plus a message count. */
export type ThreadSummary = Omit<Thread, "messages"> & { messageCount: number };

/**
 * Pluggable storage backend for threads and sessions.
 * Implement this to persist however you want:
 * in-memory, SQLite, JSONL files, Postgres, Redis, etc.
 */
export interface ThreadStore {
  // ── Thread operations ───────────────────────────────────────
  save(thread: Thread): Promise<void>;
  load(threadId: string): Promise<Thread | null>;
  list(sessionId: string): Promise<Thread[]>;
  delete(threadId: string): Promise<void>;

  // ── Session operations ──────────────────────────────────────
  saveSession(record: SessionRecord): Promise<void>;
  loadSession(sessionId: string): Promise<SessionRecord | null>;
  listSessions(): Promise<SessionRecord[]>;

  // ── Cross-session queries ───────────────────────────────────
  /** List metadata for all threads across all sessions, newest first. */
  listAll(): Promise<ThreadSummary[]>;
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

/** Raw persistence record for a tracked file change. Internal to server ↔ store boundary; never sent over the wire. */
export interface FileDiffRecord {
  sessionId: string;
  filePath: string;
  status: "added" | "modified" | "deleted";
  /** Original file content before agent touched it. null = file did not exist. */
  beforeText: string | null;
  /** File content after agent write. null = file was deleted. */
  afterText: string | null;
  unifiedDiff: string;
  linesAdded: number;
  linesRemoved: number;
  language?: string;
  updatedAt: string;
}
