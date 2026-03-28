import type { DoughEvent } from "./events.ts";
import type { SessionMeta, ThreadMeta } from "./session.ts";
import type { DiffPayload } from "./snapshots.ts";
import type { McpServerConfig, McpServerStatus } from "./mcp.ts";
import type { SkillStatus } from "./skills.ts";
import type { TodoItem } from "./todos.ts";
import type { RuntimeShortcutMeta, RuntimeCommandMeta, RuntimePanelMeta } from "./runtime.ts";

/** A tool call persisted alongside an assistant message for history replay. */
export interface HistoricalToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: "success" | "error";
  output?: string;
}

/**
 * A single message from a persisted thread's history.
 * Intentionally minimal — the full SDK transcript lives in the provider's
 * own session files; what Dough stores is user prompts + final assistant text.
 * Tool calls that occurred during an assistant turn are included so the TUI
 * can show them after a reconnect.
 */
export interface HistoricalMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: HistoricalToolCall[];
}

/** A file or image attached to a user message. */
export interface Attachment {
  type: "image";
  /** MIME type of the image */
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  /** Base64-encoded image data */
  data: string;
  /** Optional display name (e.g. "paste-1234.png") */
  name?: string;
}

// Client → Server
export type ClientMessage =
  | { kind: "send"; prompt: string; threadId?: string; attachments?: Attachment[] }
  | { kind: "resume"; sessionId: string }
  | { kind: "create"; provider: string; model?: string }
  | { kind: "abort" }
  | { kind: "tool_confirmation"; callId: string; approved: boolean }
  | { kind: "fork"; threadId: string; forkPoint?: string }
  | { kind: "list_sessions" }
  | { kind: "list_threads"; sessionId?: string }
  | { kind: "switch_thread"; threadId: string; sessionId: string }
  | { kind: "get_diffs" }
  // MCP management
  | { kind: "mcp_add"; name: string; config: McpServerConfig }
  | { kind: "mcp_remove"; name: string }
  | { kind: "mcp_list" }
  // Skills
  | { kind: "skills_list" }
  | { kind: "skill_activate"; name: string }
  // Todos
  | { kind: "todos_list"; sessionId: string }
  | { kind: "todo_verify"; todoId: string; approved: boolean }
  // Runtime interactions (client → server)
  | { kind: "runtime:get_contributions" }
  | { kind: "runtime:shortcut_triggered"; shortcutId: string }
  | { kind: "runtime:command"; commandId: string; args?: Record<string, unknown> };

// Server → Client
export type ServerMessage =
  | { kind: "event"; event: DoughEvent }
  | { kind: "session_info"; session: SessionMeta }
  | { kind: "sessions_list"; sessions: SessionMeta[] }
  | { kind: "threads_list"; threads: ThreadMeta[] }
  | { kind: "diffs"; payload: DiffPayload }
  | { kind: "error"; message: string; code?: string }
  /**
   * Sent when a "send" message is accepted but cannot run immediately because
   * another turn is in progress. `position` is 1-indexed queue depth (2 = one
   * message ahead, 3 = two messages ahead, etc.).
   */
  | { kind: "message_queued"; position: number }
  // MCP responses
  | { kind: "mcp_status"; servers: McpServerStatus[] }
  // Skills responses
  | { kind: "skills_status"; skills: SkillStatus[] }
  | { kind: "skill_content"; name: string; instructions: string }
  /**
   * Historical messages for the active thread, sent after a switch_thread or
   * resume so the TUI can populate its message panel with prior conversation.
   */
  | { kind: "thread_history"; threadId: string; messages: HistoricalMessage[] }
  // Todos
  | { kind: "todos_update"; todos: TodoItem[] }
  | { kind: "todo_verification_request"; todoId: string; title: string; instructions: string }
  // Runtime UI intents (server → client)
  | { kind: "runtime:shortcuts"; shortcuts: RuntimeShortcutMeta[] }
  | { kind: "runtime:commands"; commands: RuntimeCommandMeta[] }
  | { kind: "runtime:panels"; panels: RuntimePanelMeta[] }
  | { kind: "runtime:notify"; message: string; level: "info" | "warning" | "error" }
  | { kind: "runtime:status"; entries: Record<string, string> }
  | { kind: "runtime:open_panel"; panelId: string; data?: unknown };
