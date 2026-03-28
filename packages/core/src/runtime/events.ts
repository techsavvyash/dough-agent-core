/**
 * Platform event types and discriminated union.
 *
 * These are the lifecycle events that flow through the PlatformRuntime's
 * event bus. Extensions subscribe to these to implement cross-cutting
 * concerns like git policy, diff checkpointing, and session commands.
 */

export type PlatformEventType =
  | "session:start"
  | "session:resume"
  | "session:fork"
  | "session:before_compact"
  | "turn:start"
  | "turn:end"
  | "input:received"
  | "client:before_run"
  | "message:delta"
  | "tool:call"
  | "tool:result"
  | "git:commit_detected"
  | "ui:shortcut"
  | "ui:command";

// ── Event payloads ──────────────────────────────────────────────

export interface SessionStartEvent {
  type: "session:start";
  sessionId: string;
  threadId: string;
}

export interface SessionResumeEvent {
  type: "session:resume";
  sessionId: string;
  threadId: string;
}

export interface SessionForkEvent {
  type: "session:fork";
  sessionId: string;
  fromThreadId: string;
  newThreadId: string;
}

export interface SessionBeforeCompactEvent {
  type: "session:before_compact";
  sessionId: string;
  threadId: string;
  /** Call to prevent the default compaction. */
  cancel(): void;
  cancelled: boolean;
}

export interface TurnStartEvent {
  type: "turn:start";
  sessionId: string;
  threadId: string;
}

export interface TurnEndEvent {
  type: "turn:end";
  sessionId: string;
  threadId: string;
}

export interface InputReceivedEvent {
  type: "input:received";
  sessionId: string;
  prompt: string;
}

export interface ClientBeforeRunEvent {
  type: "client:before_run";
  sessionId: string;
  threadId: string;
}

export interface MessageDeltaEvent {
  type: "message:delta";
  text: string;
  streamId: string;
}

/**
 * Fired when a tool call is about to execute.
 * Extensions can veto the call or rewrite its arguments.
 */
export interface ToolCallEvent {
  type: "tool:call";
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Call to prevent this tool from executing. */
  veto(): void;
  /** Call to replace the tool's arguments. */
  rewrite(newArgs: Record<string, unknown>): void;
  vetoed: boolean;
  rewritten: boolean;
}

/**
 * Fired after a tool call completes.
 * Extensions can mutate the result before it propagates.
 */
export interface ToolResultEvent {
  type: "tool:result";
  callId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
  /** Call to replace the result value. */
  mutateResult(newResult: unknown): void;
}

export interface GitCommitDetectedEvent {
  type: "git:commit_detected";
  callId: string;
  command: string;
  cwd: string;
}

export interface UIShortcutEvent {
  type: "ui:shortcut";
  shortcutId: string;
}

export interface UICommandEvent {
  type: "ui:command";
  commandId: string;
  args?: Record<string, unknown>;
}

// ── Discriminated union ─────────────────────────────────────────

export type PlatformEvent =
  | SessionStartEvent
  | SessionResumeEvent
  | SessionForkEvent
  | SessionBeforeCompactEvent
  | TurnStartEvent
  | TurnEndEvent
  | InputReceivedEvent
  | ClientBeforeRunEvent
  | MessageDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | GitCommitDetectedEvent
  | UIShortcutEvent
  | UICommandEvent;

// ── Helper to extract event by type ─────────────────────────────

export type PlatformEventOfType<T extends PlatformEventType> = Extract<
  PlatformEvent,
  { type: T }
>;

// ── Factory helpers for mutable events ──────────────────────────

export function createToolCallEvent(
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
): ToolCallEvent {
  const event: ToolCallEvent = {
    type: "tool:call",
    callId,
    toolName,
    args: { ...args },
    vetoed: false,
    rewritten: false,
    veto() {
      event.vetoed = true;
    },
    rewrite(newArgs: Record<string, unknown>) {
      event.args = newArgs;
      event.rewritten = true;
    },
  };
  return event;
}

export function createToolResultEvent(
  callId: string,
  toolName: string,
  result: unknown,
  isError: boolean,
): ToolResultEvent {
  const event: ToolResultEvent = {
    type: "tool:result",
    callId,
    toolName,
    result,
    isError,
    mutateResult(newResult: unknown) {
      event.result = newResult;
    },
  };
  return event;
}

export function createSessionBeforeCompactEvent(
  sessionId: string,
  threadId: string,
): SessionBeforeCompactEvent {
  const event: SessionBeforeCompactEvent = {
    type: "session:before_compact",
    sessionId,
    threadId,
    cancelled: false,
    cancel() {
      event.cancelled = true;
    },
  };
  return event;
}
