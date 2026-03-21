import type { DoughEvent, SessionMeta } from "@dough/protocol";

export interface DoughSDKConfig {
  serverUrl?: string;
  provider?: string;
  model?: string;
}

export interface DoughSDKSession {
  readonly id: string;
  readonly sessionMeta: SessionMeta | null;

  send(prompt: string): AsyncGenerator<DoughEvent>;
  abort(): void;
  fork(threadId: string, forkPoint?: string): Promise<void>;
  disconnect(): void;
}
