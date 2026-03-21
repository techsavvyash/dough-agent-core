export enum DoughEventType {
  // Content streaming
  ContentDelta = "content_delta",
  ContentComplete = "content_complete",
  Thought = "thought",

  // Tool lifecycle
  ToolCallRequest = "tool_call_request",
  ToolCallResponse = "tool_call_response",
  ToolCallConfirmation = "tool_call_confirmation",

  // Thread lifecycle
  ThreadForked = "thread_forked",
  ThreadHandoff = "thread_handoff",
  ContextWindowWarning = "context_window_warning",

  // Session lifecycle
  SessionCreated = "session_created",
  SessionResumed = "session_resumed",

  // Control
  Error = "error",
  Finished = "finished",
  Aborted = "aborted",
}

export interface UsageMetadata {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  totalTokens: number;
  costUsd?: number;
}

export type DoughEvent =
  | { type: DoughEventType.ContentDelta; text: string; streamId: string }
  | {
      type: DoughEventType.ContentComplete;
      text: string;
      usage: UsageMetadata;
      streamId: string;
    }
  | { type: DoughEventType.Thought; text: string; streamId: string }
  | {
      type: DoughEventType.ToolCallRequest;
      callId: string;
      name: string;
      args: Record<string, unknown>;
      streamId: string;
    }
  | {
      type: DoughEventType.ToolCallResponse;
      callId: string;
      result: unknown;
      isError?: boolean;
      streamId: string;
    }
  | {
      type: DoughEventType.ToolCallConfirmation;
      callId: string;
      approved: boolean;
    }
  | {
      type: DoughEventType.ThreadForked;
      fromThreadId: string;
      newThreadId: string;
      reason: string;
    }
  | {
      type: DoughEventType.ThreadHandoff;
      fromThreadId: string;
      toThreadId: string;
      summary: string;
    }
  | {
      type: DoughEventType.ContextWindowWarning;
      threadId: string;
      usedTokens: number;
      maxTokens: number;
    }
  | { type: DoughEventType.SessionCreated; sessionId: string; threadId: string }
  | {
      type: DoughEventType.SessionResumed;
      sessionId: string;
      threadId: string;
    }
  | { type: DoughEventType.Error; message: string; code?: string }
  | {
      type: DoughEventType.Finished;
      reason: "completed" | "max_turns" | "max_tokens" | "aborted";
      usage?: UsageMetadata;
    }
  | { type: DoughEventType.Aborted };
