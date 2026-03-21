import type { DoughEvent } from "./events.ts";
import type { SessionMeta, ThreadMeta } from "./session.ts";

// Client → Server
export type ClientMessage =
  | { kind: "send"; prompt: string; threadId?: string }
  | { kind: "resume"; sessionId: string }
  | { kind: "create"; provider: string; model?: string }
  | { kind: "abort" }
  | { kind: "tool_confirmation"; callId: string; approved: boolean }
  | { kind: "fork"; threadId: string; forkPoint?: string }
  | { kind: "list_sessions" }
  | { kind: "list_threads"; sessionId: string };

// Server → Client
export type ServerMessage =
  | { kind: "event"; event: DoughEvent }
  | { kind: "session_info"; session: SessionMeta }
  | { kind: "sessions_list"; sessions: SessionMeta[] }
  | { kind: "threads_list"; threads: ThreadMeta[] }
  | { kind: "error"; message: string; code?: string };
