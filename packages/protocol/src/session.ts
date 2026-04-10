export type ThreadStatus = "active" | "full" | "archived";

/** How a thread was created relative to its parent */
export type ThreadOrigin = "root" | "handoff" | "fork";

export interface ThreadMeta {
  id: string;
  sessionId: string;
  parentThreadId?: string;
  /** How this thread was created: root (first), handoff (context overflow), fork (user branched) */
  origin: ThreadOrigin;
  status: ThreadStatus;
  tokenCount: number;
  maxTokens: number;
  /** Cumulative actual LLM usage (input + output tokens consumed). */
  tokensUsed: number;
  messageCount: number;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMeta {
  id: string;
  activeThreadId: string;
  threads: ThreadMeta[];
  provider: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}
