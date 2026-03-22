import { DoughEventType } from "@dough/protocol";
import type {
  DoughEvent,
  UsageMetadata,
  McpServerMap,
  McpServerStatus,
} from "@dough/protocol";
import type { ThreadMessage } from "@dough/threads";
import type { LLMProvider, SendOptions } from "./provider.ts";
import {
  query,
  listSessions,
  forkSession,
  type SDKMessage,
  type Options,
  type HookCallbackMatcher,
  type HookEvent,
  type HookInput,
  type PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { ToolMiddleware } from "./provider.ts";

export interface ClaudeProviderConfig {
  model?: string;
  cwd?: string;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  includePartialMessages?: boolean;
  effort?: "low" | "medium" | "high" | "max";
}

/**
 * Claude provider using @anthropic-ai/claude-agent-sdk V1 stable API.
 *
 * Uses query() with persistSession for JSONL session persistence,
 * includePartialMessages for token-level streaming, and
 * resume for session continuation.
 */
export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  readonly maxContextTokens = 200_000;
  readonly supportsMcp = true;

  private config: ClaudeProviderConfig;
  private activeSessionId: string | null = null;
  /** MCP servers in claude-agent-sdk native format */
  private mcpServers: Record<string, unknown> = {};

  constructor(config: ClaudeProviderConfig = {}) {
    this.config = {
      model: config.model ?? "sonnet",
      permissionMode: config.permissionMode ?? "bypassPermissions",
      includePartialMessages: config.includePartialMessages ?? true,
      effort: config.effort ?? "medium",
      ...config,
    };
  }

  get sessionId(): string | null {
    return this.activeSessionId;
  }

  async *send(
    messages: ThreadMessage[],
    options: SendOptions
  ): AsyncGenerator<DoughEvent> {
    // Build the prompt from the last user message
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMessage) {
      yield {
        type: DoughEventType.Error,
        message: "No user message found in thread",
      };
      return;
    }

    const queryOptions: Options = {
      model: options.model ?? this.config.model,
      cwd: this.config.cwd ?? process.cwd(),
      persistSession: true,
      includePartialMessages: this.config.includePartialMessages,
      permissionMode: this.config.permissionMode,
      allowedTools: this.config.allowedTools,
      disallowedTools: this.config.disallowedTools,
      maxTurns: this.config.maxTurns,
      maxBudgetUsd: this.config.maxBudgetUsd,
      effort: this.config.effort,
      abortController: options.signal
        ? abortControllerFromSignal(options.signal)
        : undefined,
    };

    // Translate provider-agnostic ToolMiddleware into SDK-native PreToolUse hooks.
    // This adapter is Claude-specific; other providers implement their own adapter.
    if (options.toolMiddleware && options.toolMiddleware.length > 0) {
      queryOptions.hooks = toolMiddlewareToHooks(options.toolMiddleware);
    }

    // Add MCP servers if configured
    if (Object.keys(this.mcpServers).length > 0) {
      (queryOptions as Record<string, unknown>).mcpServers = this.mcpServers;
    }

    // Add system prompt if provided
    if (options.systemPrompt ?? this.config.systemPrompt) {
      queryOptions.systemPrompt = options.systemPrompt ?? this.config.systemPrompt;
    }

    // Resume existing session or start new
    if (this.activeSessionId) {
      queryOptions.resume = this.activeSessionId;
    }

    const streamId = crypto.randomUUID();
    let fullText = "";
    let capturedSessionId: string | null = null;
    let gotStreamDeltas = false;
    let lastUsage: UsageMetadata = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    // Attempt the query — may need to retry without `resume` if the
    // provider-native session JSONL was deleted (server restart, cleanup, etc.)
    let retried = false;

    const runQuery = async function* (
      self: ClaudeProvider,
      opts: Options
    ): AsyncGenerator<DoughEvent> {
      try {
        const q = query({
          prompt: lastUserMessage.content,
          options: opts,
        });

        for await (const message of q) {
          // Track session ID from any message
          if ("session_id" in message && message.session_id) {
            capturedSessionId = message.session_id;
          }

          // When we have partial streaming, skip the duplicate full assistant message text
          const isStreaming = self.config.includePartialMessages;
          const events = mapSDKMessageToDoughEvents(
            message,
            streamId,
            isStreaming && gotStreamDeltas
          );

          for (const event of events) {
            if (event.type === DoughEventType.ContentDelta) {
              fullText += event.text;
              if (message.type === "stream_event") {
                gotStreamDeltas = true;
              }
            }

            // Capture usage from Finished events for ContentComplete
            if (event.type === DoughEventType.Finished && event.usage) {
              lastUsage = event.usage;
            }

            // Emit ContentComplete before Finished
            if (event.type === DoughEventType.Finished && fullText) {
              yield {
                type: DoughEventType.ContentComplete,
                text: fullText,
                usage: lastUsage,
                streamId,
              };
            }

            yield event;
          }
        }

        // Update tracked session ID
        if (capturedSessionId) {
          self.activeSessionId = capturedSessionId;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);

        // The SDK session JSONL may have been deleted (server restart, cleanup).
        // Retry once without `resume` so we start a fresh SDK session while
        // keeping Dough-level thread history intact.
        if (!retried && msg.includes("No conversation found")) {
          retried = true;
          self.activeSessionId = null;
          const freshOpts = { ...opts };
          delete freshOpts.resume;
          yield* runQuery(self, freshOpts);
          return;
        }

        yield {
          type: DoughEventType.Error,
          message: msg,
        };
      }
    };

    yield* runQuery(this, queryOptions);
  }

  async estimateTokens(messages: ThreadMessage[]): Promise<number> {
    // Rough estimate: ~4 chars per token for English text
    return messages.reduce(
      (sum, msg) => sum + Math.ceil(msg.content.length / 4),
      0
    );
  }

  async createSession(options?: {
    sessionId?: string;
    model?: string;
  }): Promise<string> {
    if (options?.sessionId) {
      this.activeSessionId = options.sessionId;
      return options.sessionId;
    }
    // Session ID will be assigned by claude-agent-sdk on first query
    return this.activeSessionId ?? "pending";
  }

  async listSessions(dir?: string) {
    return listSessions({ dir });
  }

  async forkSession(sessionId: string, options?: { upToMessageId?: string; title?: string }) {
    return forkSession(sessionId, options);
  }

  async dispose(): Promise<void> {
    this.activeSessionId = null;
  }

  // ── MCP adapter ────────────────────────────────────────────

  /**
   * Map generic McpServerMap to claude-agent-sdk's native format
   * and store for use in subsequent query() calls.
   */
  async setMcpServers(servers: McpServerMap): Promise<void> {
    const native: Record<string, unknown> = {};
    for (const [name, config] of Object.entries(servers)) {
      switch (config.transport) {
        case "stdio":
          native[name] = {
            type: "stdio",
            command: config.command,
            args: config.args,
            env: config.env,
          };
          break;
        case "sse":
          native[name] = {
            type: "sse",
            url: config.url,
            headers: config.headers,
          };
          break;
        case "http":
          native[name] = {
            type: "http",
            url: config.url,
            headers: config.headers,
          };
          break;
      }
    }
    this.mcpServers = native;
  }

  async getMcpStatus(): Promise<McpServerStatus[]> {
    // claude-agent-sdk exposes mcpServerStatus() on Session objects,
    // but we don't hold a persistent Session ref here (query() is stateless).
    // Return synthetic status from our stored config.
    return Object.entries(this.mcpServers).map(([name, config]) => ({
      name,
      connected: true,
      transport: ((config as Record<string, unknown>).type as "stdio" | "sse" | "http") ?? "stdio",
      toolCount: 0,
    }));
  }
}

/**
 * Maps claude-agent-sdk SDKMessage to DoughEvent(s).
 * A single SDK message may produce zero or more DoughEvents.
 */
function mapSDKMessageToDoughEvents(
  message: SDKMessage,
  streamId: string,
  skipAssistantText: boolean = false
): DoughEvent[] {
  const events: DoughEvent[] = [];

  switch (message.type) {
    case "assistant": {
      // When streaming is enabled and we already got deltas, skip duplicate text
      if (!skipAssistantText) {
        // Cast to unknown[] first to avoid SDK type conflicts when @anthropic-ai/sdk
        // is present in the dependency tree (its BetaContentBlock union is narrower).
        const contentBlocks = message.message.content as unknown[];
        const textBlocks = contentBlocks.filter(
          (block): block is { type: "text"; text: string } =>
            typeof block === "object" && block !== null && (block as { type: string }).type === "text"
        );
        const text = textBlocks.map((b) => b.text).join("");
        if (text) {
          events.push({
            type: DoughEventType.ContentDelta,
            text,
            streamId,
          });
        }
      }

      // Always extract tool use blocks (not duplicated by stream events)
      const toolUseBlocks = (message.message.content as unknown[]).filter(
        (block): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
          typeof block === "object" && block !== null && (block as { type: string }).type === "tool_use"
      );
      for (const tool of toolUseBlocks) {
        events.push({
          type: DoughEventType.ToolCallRequest,
          callId: tool.id,
          name: tool.name,
          args: tool.input as Record<string, unknown>,
          streamId,
        });
      }
      break;
    }

    case "stream_event": {
      // Partial streaming event — token-level deltas
      const event = message.event;
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if ("text" in delta && delta.text) {
          events.push({
            type: DoughEventType.ContentDelta,
            text: delta.text,
            streamId,
          });
        }
        if (delta.type === "thinking_delta" && "thinking" in delta) {
          events.push({
            type: DoughEventType.Thought,
            text: (delta as { thinking: string }).thinking,
            streamId,
          });
        }
      }
      break;
    }

    case "result": {
      const usage: UsageMetadata = {
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        totalTokens:
          (message.usage?.input_tokens ?? 0) +
          (message.usage?.output_tokens ?? 0),
        costUsd: message.total_cost_usd,
      };

      if (message.is_error) {
        events.push({
          type: DoughEventType.Error,
          message: "errors" in message ? message.errors.join("; ") : "Unknown error",
          code: message.subtype,
        });
      }

      events.push({
        type: DoughEventType.Finished,
        reason: message.is_error ? "completed" : "completed",
        usage,
      });
      break;
    }

    case "user": {
      // User message with tool results — extract tool_result blocks
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            (block as { type: string }).type === "tool_result"
          ) {
            const tb = block as {
              type: "tool_result";
              tool_use_id: string;
              content?: unknown;
              is_error?: boolean;
            };
            events.push({
              type: DoughEventType.ToolCallResponse,
              callId: tb.tool_use_id,
              result: tb.content,
              isError: tb.is_error,
              streamId,
            });
          }
        }
      }
      break;
    }

    case "system": {
      // System init message — we use this to capture session_id
      // No DoughEvent needed, handled in the main loop
      break;
    }

    // Ignore other message types for now
    default:
      break;
  }

  return events;
}

/**
 * Adapter: converts provider-agnostic ToolMiddleware[] into the SDK's native
 * `hooks.PreToolUse` format.
 *
 * Each ToolMiddleware becomes one HookCallbackMatcher. If the middleware
 * declares a `toolName` filter, the matcher's `matcher` field restricts it to
 * that tool. The hook calls `middleware.beforeToolUse()` and, if it returns a
 * modified input, injects `updatedInput` into the SDK's PreToolUse output so
 * the tool runs with the new arguments.
 */
function toolMiddlewareToHooks(
  middleware: ToolMiddleware[]
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const matchers: HookCallbackMatcher[] = middleware
    .filter((m) => typeof m.beforeToolUse === "function")
    .map((m) => ({
      matcher: m.toolName,
      hooks: [
        async (input: HookInput) => {
          // The matcher fires for PreToolUse — guard the discriminant anyway
          if (input.hook_event_name !== "PreToolUse") {
            return { hookEventName: "PreToolUse" } as const;
          }

          const preInput = input as PreToolUseHookInput;
          const toolInput = (preInput.tool_input ?? {}) as Record<string, unknown>;
          const updatedInput = await m.beforeToolUse!(preInput.tool_name, toolInput);

          if (!updatedInput) {
            return { hookEventName: "PreToolUse" } as const;
          }

          return {
            hookEventName: "PreToolUse",
            hookSpecificOutput: {
              hookEventName: "PreToolUse" as const,
              updatedInput,
            },
          } as const;
        },
      ],
    }));

  return matchers.length > 0 ? { PreToolUse: matchers } : {};
}

/**
 * Create an AbortController that aborts when the given signal aborts.
 */
function abortControllerFromSignal(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller;
}
