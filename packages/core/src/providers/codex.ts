import { DoughEventType } from "@dough/protocol";
import type {
  DoughEvent,
  UsageMetadata,
  McpServerMap,
  McpServerStatus,
} from "@dough/protocol";
import type { ThreadMessage } from "@dough/threads";
import type { LLMProvider, SendOptions, ToolMiddleware } from "./provider.ts";
import {
  Codex,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
  type CodexOptions,
} from "@openai/codex-sdk";

export interface CodexProviderConfig {
  model?: string;
  cwd?: string;
  /** Environment variables passed to the Codex CLI process. */
  env?: Record<string, string>;
  /** OpenAI / Codex API key. Falls back to CODEX_API_KEY / OPENAI_API_KEY env vars. */
  apiKey?: string;
  /** Sandbox mode for the Codex CLI. Defaults to "danger-full-access" (matches bypassPermissions). */
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  /** Approval policy. Defaults to "never" for autonomous operation. */
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  /** Model reasoning effort. Defaults to "medium". */
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Additional Codex CLI config overrides (TOML key=value). */
  config?: Record<string, unknown>;
}

/**
 * Codex provider using @openai/codex-sdk.
 *
 * Wraps the Codex SDK:
 * - new Codex() → codex.startThread() / codex.resumeThread(id)
 * - thread.runStreamed(input) → { events: AsyncGenerator<ThreadEvent> }
 * - JSONL persistence in ~/.codex/sessions
 *
 * The Codex SDK spawns the `codex` CLI as a subprocess. The CLI handles all
 * tool execution (bash, file writes, MCP, etc.) internally — unlike the Claude
 * provider where tools are invoked by the SDK and we see individual tool_use
 * blocks, Codex yields higher-level "item" events (command_execution,
 * file_change, mcp_tool_call) that we map to DoughEvent ToolCallRequest /
 * ToolCallResponse pairs.
 */
export class CodexProvider implements LLMProvider {
  readonly name = "codex";
  readonly maxContextTokens = 200_000;
  readonly supportsMcp = true;

  private config: CodexProviderConfig;
  private codex: Codex;
  private activeThreadId: string | null = null;
  private mcpServers: McpServerMap = {};

  constructor(config: CodexProviderConfig = {}) {
    this.config = {
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
      reasoningEffort: "medium",
      ...config,
    };

    const codexOptions: CodexOptions = {};
    if (this.config.apiKey) {
      codexOptions.apiKey = this.config.apiKey;
    }
    if (this.config.env) {
      codexOptions.env = this.config.env;
    }
    if (this.config.config) {
      codexOptions.config = this.config.config as Record<string, string>;
    }

    this.codex = new Codex(codexOptions);
  }

  get sessionId(): string | null {
    return this.activeThreadId;
  }

  async *send(
    messages: ThreadMessage[],
    options: SendOptions
  ): AsyncGenerator<DoughEvent> {
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUserMessage) {
      yield {
        type: DoughEventType.Error,
        message: "No user message found in thread",
      };
      return;
    }

    const streamId = crypto.randomUUID();
    let fullText = "";
    let lastUsage: UsageMetadata = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };

    // Build thread options
    const threadOptions: ThreadOptions = {
      model: options.model ?? this.config.model,
      workingDirectory: this.config.cwd ?? process.cwd(),
      sandboxMode: this.config.sandboxMode,
      approvalPolicy: this.config.approvalPolicy,
      modelReasoningEffort: this.config.reasoningEffort,
      skipGitRepoCheck: true,
    };

    // Build input — text + optional image attachments
    const input = buildInput(lastUserMessage.content, options);

    try {
      // Start or resume thread
      const thread = this.activeThreadId
        ? this.codex.resumeThread(this.activeThreadId, threadOptions)
        : this.codex.startThread(threadOptions);

      const { events } = await thread.runStreamed(input, {
        signal: options.signal,
      });

      for await (const event of events) {
        // Check abort
        if (options.signal?.aborted) {
          yield { type: DoughEventType.Aborted };
          return;
        }

        const doughEvents = mapCodexEventToDoughEvents(
          event,
          streamId,
          options.toolMiddleware
        );

        for (const de of doughEvents) {
          // Track text accumulation
          if (de.type === DoughEventType.ContentDelta) {
            fullText += de.text;
          }

          // Capture usage from Finished events
          if (de.type === DoughEventType.Finished && de.usage) {
            lastUsage = de.usage;
          }

          // Emit ContentComplete before Finished
          if (de.type === DoughEventType.Finished && fullText) {
            yield {
              type: DoughEventType.ContentComplete,
              text: fullText,
              usage: lastUsage,
              streamId,
            };
          }

          yield de;
        }

        // Capture thread ID from thread.started
        if (event.type === "thread.started") {
          this.activeThreadId = event.thread_id;
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // If resuming a stale thread, retry with a fresh one
      if (this.activeThreadId && msg.includes("session")) {
        this.activeThreadId = null;
        yield* this.send(messages, options);
        return;
      }

      yield {
        type: DoughEventType.Error,
        message: msg,
      };
    }
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
      this.activeThreadId = options.sessionId;
      return options.sessionId;
    }
    // Thread ID assigned on first runStreamed() call
    return this.activeThreadId ?? "pending";
  }

  async dispose(): Promise<void> {
    this.activeThreadId = null;
  }

  // ── MCP support ────────────────────────────────────────────

  async setMcpServers(servers: McpServerMap): Promise<void> {
    this.mcpServers = { ...servers };
    // MCP servers are configured at the Codex CLI level via config overrides.
    // The Codex CLI discovers MCP servers from its own config; we store them
    // here for status reporting. Full native pass-through would require
    // thread-level config injection which the SDK doesn't expose yet.
  }

  async getMcpStatus(): Promise<McpServerStatus[]> {
    return Object.entries(this.mcpServers).map(([name, config]) => ({
      name,
      connected: true,
      transport: config.transport,
      toolCount: 0,
    }));
  }
}

// ── Event mapping ──────────────────────────────────────────────

/**
 * Maps a Codex SDK ThreadEvent to zero or more DoughEvents.
 *
 * The Codex SDK yields high-level item events rather than raw tool_use blocks.
 * We map them to ToolCallRequest/ToolCallResponse pairs so the Dough session
 * loop can track them consistently with the Claude provider.
 *
 * Tool names are passed through from the Codex SDK's native item types
 * (e.g. "command_execution", "file_change", "web_search") rather than
 * being mapped to provider-specific names. For MCP tool calls, the
 * actual tool name (item.tool) is used. The TUI's formatToolName()
 * handles display labels for all known item types.
 *
 * Mapping:
 *   item.started  (command_execution) → ToolCallRequest  (name: "command_execution")
 *   item.completed (command_execution) → ToolCallResponse (with output)
 *   item.started  (file_change)       → ToolCallRequest  (name: "file_change")
 *   item.completed (file_change)      → ToolCallResponse
 *   item.started  (mcp_tool_call)     → ToolCallRequest  (name: item.tool)
 *   item.completed (mcp_tool_call)    → ToolCallResponse
 *   item.started/completed (agent_message) → ContentDelta
 *   item.started/completed (reasoning)     → Thought
 *   turn.completed                         → Finished
 *   turn.failed / error                    → Error
 */
function mapCodexEventToDoughEvents(
  event: ThreadEvent,
  streamId: string,
  _toolMiddleware?: ToolMiddleware[]
): DoughEvent[] {
  const events: DoughEvent[] = [];

  switch (event.type) {
    case "thread.started":
      // No DoughEvent — thread ID captured in main loop
      break;

    case "turn.started":
      // No direct DoughEvent equivalent
      break;

    case "turn.completed": {
      const usage: UsageMetadata = {
        inputTokens: event.usage?.input_tokens ?? 0,
        outputTokens: event.usage?.output_tokens ?? 0,
        cachedTokens: event.usage?.cached_input_tokens ?? 0,
        totalTokens:
          (event.usage?.input_tokens ?? 0) +
          (event.usage?.output_tokens ?? 0),
      };
      events.push({
        type: DoughEventType.Finished,
        reason: "completed",
        usage,
      });
      break;
    }

    case "turn.failed": {
      events.push({
        type: DoughEventType.Error,
        message: event.error?.message ?? "Turn failed",
      });
      events.push({
        type: DoughEventType.Finished,
        reason: "completed",
      });
      break;
    }

    case "error": {
      events.push({
        type: DoughEventType.Error,
        message: event.message ?? "Unknown error",
      });
      break;
    }

    case "item.started": {
      events.push(...mapItemStarted(event.item, streamId));
      break;
    }

    case "item.updated": {
      events.push(...mapItemUpdated(event.item, streamId));
      break;
    }

    case "item.completed": {
      events.push(...mapItemCompleted(event.item, streamId));
      break;
    }
  }

  return events;
}

/**
 * Map an item.started event to DoughEvents.
 * For tool-like items, emit a ToolCallRequest.
 * For content items, emit deltas/thoughts.
 */
function mapItemStarted(item: ThreadItem, streamId: string): DoughEvent[] {
  const events: DoughEvent[] = [];

  switch (item.type) {
    case "agent_message":
      // Emit as content delta — the text will accumulate
      if (item.text) {
        events.push({
          type: DoughEventType.ContentDelta,
          text: item.text,
          streamId,
        });
      }
      break;

    case "reasoning":
      if (item.text) {
        events.push({
          type: DoughEventType.Thought,
          text: item.text,
          streamId,
        });
      }
      break;

    case "command_execution":
      events.push({
        type: DoughEventType.ToolCallRequest,
        callId: item.id,
        name: item.type,
        args: { command: item.command },
        streamId,
      });
      break;

    case "file_change":
      events.push({
        type: DoughEventType.ToolCallRequest,
        callId: item.id,
        name: item.type,
        args: {
          files: item.changes.map((c) => ({
            path: c.path,
            kind: c.kind,
          })),
        },
        streamId,
      });
      break;

    case "mcp_tool_call":
      events.push({
        type: DoughEventType.ToolCallRequest,
        callId: item.id,
        name: item.tool,
        args: {
          server: item.server,
          ...(item.arguments as Record<string, unknown> ?? {}),
        },
        streamId,
      });
      break;

    case "web_search":
      events.push({
        type: DoughEventType.ToolCallRequest,
        callId: item.id,
        name: item.type,
        args: { query: item.query },
        streamId,
      });
      break;

    case "todo_list":
      // No ToolCallRequest — informational only
      break;

    case "error":
      events.push({
        type: DoughEventType.Error,
        message: item.message,
      });
      break;
  }

  return events;
}

/**
 * Map item.updated events. For streaming content, emit incremental deltas.
 */
function mapItemUpdated(item: ThreadItem, streamId: string): DoughEvent[] {
  const events: DoughEvent[] = [];

  switch (item.type) {
    case "agent_message":
      // Updated agent message — emit as delta (the text is the full accumulated text,
      // but we treat updates as new content for now)
      if (item.text) {
        events.push({
          type: DoughEventType.ContentDelta,
          text: item.text,
          streamId,
        });
      }
      break;

    case "reasoning":
      if (item.text) {
        events.push({
          type: DoughEventType.Thought,
          text: item.text,
          streamId,
        });
      }
      break;

    case "command_execution":
      // In-progress output — could emit as streaming tool output but
      // the TUI doesn't render intermediate tool output, so skip.
      break;

    default:
      break;
  }

  return events;
}

/**
 * Map item.completed events. For tool-like items, emit ToolCallResponse.
 */
function mapItemCompleted(item: ThreadItem, streamId: string): DoughEvent[] {
  const events: DoughEvent[] = [];

  switch (item.type) {
    case "agent_message":
      // Final agent message — emit as delta if we haven't already
      // The session loop accumulates all deltas into fullText.
      if (item.text) {
        events.push({
          type: DoughEventType.ContentDelta,
          text: item.text,
          streamId,
        });
      }
      break;

    case "reasoning":
      if (item.text) {
        events.push({
          type: DoughEventType.Thought,
          text: item.text,
          streamId,
        });
      }
      break;

    case "command_execution":
      events.push({
        type: DoughEventType.ToolCallResponse,
        callId: item.id,
        result: item.aggregated_output ?? "",
        isError: item.status === "failed" || (item.exit_code != null && item.exit_code !== 0),
        streamId,
      });
      break;

    case "file_change":
      events.push({
        type: DoughEventType.ToolCallResponse,
        callId: item.id,
        result: item.changes
          .map(
            (c) => `${c.kind}: ${c.path}`
          )
          .join("\n"),
        isError: item.status === "failed",
        streamId,
      });
      break;

    case "mcp_tool_call":
      events.push({
        type: DoughEventType.ToolCallResponse,
        callId: item.id,
        result: item.error
          ? item.error.message
          : item.result
            ? item.result.structured_content ?? item.result.content
            : "",
        isError: item.status === "failed" || !!item.error,
        streamId,
      });
      break;

    case "web_search":
      events.push({
        type: DoughEventType.ToolCallResponse,
        callId: item.id,
        result: `Web search completed: ${item.query}`,
        isError: false,
        streamId,
      });
      break;

    case "todo_list":
      // Informational — no ToolCallResponse needed
      break;

    case "error":
      events.push({
        type: DoughEventType.Error,
        message: item.message,
      });
      break;
  }

  return events;
}

// ── Input builder ──────────────────────────────────────────────

/**
 * Build the input for thread.runStreamed().
 *
 * Plain text → string (fast path)
 * Text + image attachments → UserInput[] with local_image entries
 *
 * Note: The Codex SDK supports local_image inputs by file path, but our
 * Attachment type carries base64 data. We write to temp files for images.
 */
function buildInput(
  text: string,
  options: SendOptions
): string | Array<{ type: "text"; text: string } | { type: "local_image"; path: string }> {
  if (!options.attachments || options.attachments.length === 0) {
    return text;
  }

  // Write base64 images to temp files and pass paths
  const inputs: Array<
    { type: "text"; text: string } | { type: "local_image"; path: string }
  > = [];

  for (const attachment of options.attachments) {
    const tmpPath = `/tmp/dough-codex-${crypto.randomUUID()}.${mimeToExt(attachment.mimeType)}`;
    const buffer = Buffer.from(attachment.data, "base64");
    // Synchronous write is fine here — temp files are small images
    Bun.write(tmpPath, buffer);
    inputs.push({ type: "local_image", path: tmpPath });
  }

  inputs.push({ type: "text", text });
  return inputs;
}

function mimeToExt(
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
  }
}
