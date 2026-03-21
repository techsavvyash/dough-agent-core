export type ThreadStatus = "active" | "full" | "archived";

export interface ThreadMeta {
  id: string;
  sessionId: string;
  parentThreadId?: string;
  status: ThreadStatus;
  tokenCount: number;
  maxTokens: number;
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
