/**
 * Codex provider — OpenAI Responses API with local tool execution.
 *
 * Implements LLMProvider using raw fetch() to the OpenAI Responses API,
 * with an agentic loop that:
 *   1. Streams a response via SSE
 *   2. Collects function_call items
 *   3. Executes tools locally (Bash, Read, Write, Edit, Glob, Grep)
 *   4. Sends results back as function_call_output
 *   5. Repeats until the model stops requesting tools
 *
 * Auth modes:
 *   - OAuth (subscription): POST to chatgpt.com/backend-api/codex/responses
 *     with Bearer JWT + chatgpt-account-id header
 *   - API key: POST to api.openai.com/v1/responses with Bearer sk-...
 *
 * Tool names use Claude's convention (Bash, Write, Read, Edit, Glob, Grep)
 * so all extensions and middleware work identically across providers.
 */
import { DoughEventType } from "@dough/protocol";
import type {
  DoughEvent,
  UsageMetadata,
  McpServerMap,
  McpServerStatus,
} from "@dough/protocol";
import type { ThreadMessage } from "@dough/threads";
import type { LLMProvider, SendOptions, ToolMiddleware } from "./provider.ts";
import { getBuiltinToolSchemas, toOpenAIFunctions } from "../tools/definitions.ts";
import { executeTool } from "../tools/executor.ts";
import { getValidToken, type ValidToken } from "../auth/openai-oauth.ts";

// ── Config ────────────────────────────────────────────────────────

export interface CodexProviderConfig {
  /** Model ID, e.g. "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex". Defaults to "gpt-5.4". */
  model?: string;
  /** Working directory for tool execution. Defaults to process.cwd(). */
  cwd?: string;
  /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** OAuth client ID for ChatGPT subscription auth. */
  oauthClientId?: string;
  /** Path to OAuth credentials file. Defaults to ~/.dough/auth.json. */
  oauthCredentialsPath?: string;
  /** Override API endpoint base URL. */
  baseUrl?: string;
  /** Max agentic loop iterations (tool round-trips). Defaults to 30. */
  maxTurns?: number;
  /** Model reasoning effort. */
  reasoningEffort?: "low" | "medium" | "high";
}

// ── Auth resolution ───────────────────────────────────────────────

interface ResolvedAuth {
  baseUrl: string;
  headers: Record<string, string>;
}

async function resolveAuth(config: CodexProviderConfig): Promise<ResolvedAuth> {
  // 1. Try API key first (explicit config or env var)
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (apiKey) {
    return {
      baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    };
  }

  // 2. Try OAuth credentials (subscription reuse) — always check default path
  const token = await getValidToken(config.oauthCredentialsPath);
  if (token) {
    return {
      baseUrl: config.baseUrl ?? "https://chatgpt.com/backend-api/codex",
      headers: {
        Authorization: `Bearer ${token.token}`,
        "chatgpt-account-id": token.accountId,
        "Content-Type": "application/json",
      },
    };
  }

  throw new Error(
    "No OpenAI auth configured. Set OPENAI_API_KEY env var, " +
      "provide apiKey in config, or run `codex` CLI to set up OAuth."
  );
}

// ── SSE types ─────────────────────────────────────────────────────

interface PendingFunctionCall {
  id: string;      // item id (fc_xxx) — used when sending back function_call items
  call_id: string; // call_id (call_xxx) — used to match function_call_output
  name: string;
  arguments: string; // JSON string
}

// ── Provider ──────────────────────────────────────────────────────

export class CodexProvider implements LLMProvider {
  readonly name = "codex";
  readonly maxContextTokens = 200_000;
  readonly supportsMcp = false;

  private config: CodexProviderConfig;
  private cwd: string;
  private responseId: string | null = null;
  private mcpServers: McpServerMap = {};

  constructor(config: CodexProviderConfig = {}) {
    this.config = {
      ...config,
      model: config.model ?? "gpt-5.4",
      maxTurns: config.maxTurns ?? 30,
    };
    this.cwd = config.cwd ?? process.cwd();
  }

  get sessionId(): string | null {
    return this.responseId;
  }

  async *send(
    messages: ThreadMessage[],
    options: SendOptions
  ): AsyncGenerator<DoughEvent> {
    const streamId = crypto.randomUUID();

    // Resolve auth
    let auth: ResolvedAuth;
    try {
      auth = await resolveAuth(this.config);
    } catch (err) {
      yield {
        type: DoughEventType.Error,
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    const toolDefs = toOpenAIFunctions(getBuiltinToolSchemas());
    let input = convertMessages(messages, options);
    let previousResponseId = this.responseId;
    let totalUsage: UsageMetadata = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    let fullText = "";
    let turnCount = 0;
    const maxTurns = this.config.maxTurns ?? 30;

    // Agentic loop
    while (turnCount < maxTurns) {
      turnCount++;

      if (options.signal?.aborted) {
        yield { type: DoughEventType.Aborted };
        return;
      }

      // 1. Stream one API call
      const pendingCalls: PendingFunctionCall[] = [];
      let turnText = "";

      try {
        for await (const sseEvent of this.streamRequest(
          auth,
          input,
          toolDefs,
          previousResponseId,
          options
        )) {
          if (options.signal?.aborted) {
            yield { type: DoughEventType.Aborted };
            return;
          }

          switch (sseEvent.kind) {
            case "text_delta":
              turnText += sseEvent.text;
              fullText += sseEvent.text;
              yield {
                type: DoughEventType.ContentDelta,
                text: sseEvent.text,
                streamId,
              };
              break;

            case "reasoning_delta":
              yield {
                type: DoughEventType.Thought,
                text: sseEvent.text,
                streamId,
              };
              break;

            case "function_call":
              pendingCalls.push(sseEvent.call);
              break;

            case "response_completed":
              this.responseId = sseEvent.responseId;
              previousResponseId = sseEvent.responseId;
              if (sseEvent.usage) {
                totalUsage = {
                  inputTokens:
                    totalUsage.inputTokens + (sseEvent.usage.input_tokens ?? 0),
                  outputTokens:
                    totalUsage.outputTokens + (sseEvent.usage.output_tokens ?? 0),
                  cachedTokens: sseEvent.usage.input_tokens_details?.cached_tokens,
                  totalTokens:
                    totalUsage.inputTokens +
                    totalUsage.outputTokens +
                    (sseEvent.usage.input_tokens ?? 0) +
                    (sseEvent.usage.output_tokens ?? 0),
                };
              }
              break;

            case "error":
              yield {
                type: DoughEventType.Error,
                message: sseEvent.message,
              };
              break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // Stale response ID — clear and retry fresh
        if (
          previousResponseId &&
          (msg.includes("not found") || msg.includes("invalid"))
        ) {
          this.responseId = null;
          previousResponseId = null;
          turnCount--; // don't count this as a turn
          continue;
        }

        yield { type: DoughEventType.Error, message: msg };
        break;
      }

      // No tool calls → model is done
      if (pendingCalls.length === 0) break;

      // 2. Execute tools locally
      const toolResults: Array<{
        call_id: string;
        output: string;
      }> = [];

      for (const call of pendingCalls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          args = {};
        }

        // Apply middleware
        for (const mw of options.toolMiddleware ?? []) {
          if (mw.toolName && mw.toolName !== call.name) continue;
          const modified = await mw.beforeToolUse?.(call.name, args);
          if (modified) args = modified;
        }

        // Yield ToolCallRequest
        yield {
          type: DoughEventType.ToolCallRequest,
          callId: call.call_id,
          name: call.name,
          args,
          streamId,
        };

        // Execute
        const result = await executeTool(call.name, args, this.cwd);

        // Yield ToolCallResponse
        yield {
          type: DoughEventType.ToolCallResponse,
          callId: call.call_id,
          result: result.result,
          isError: result.isError,
          streamId,
        };

        toolResults.push({
          call_id: call.call_id,
          output: result.result,
        });

        // Check abort between tool executions
        if (options.signal?.aborted) {
          yield { type: DoughEventType.Aborted };
          return;
        }
      }

      // 3. Build input for next turn — include function_call items
      //    followed by their function_call_output results
      const nextInput: unknown[] = [];
      for (const call of pendingCalls) {
        nextInput.push({
          type: "function_call",
          id: call.id,
          call_id: call.call_id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      for (const r of toolResults) {
        nextInput.push({
          type: "function_call_output",
          call_id: r.call_id,
          output: r.output,
        });
      }
      input = nextInput;
    }

    // Emit ContentComplete if we accumulated any text
    if (fullText) {
      yield {
        type: DoughEventType.ContentComplete,
        text: fullText,
        usage: totalUsage,
        streamId,
      };
    }

    // Finished
    yield {
      type: DoughEventType.Finished,
      reason: turnCount >= maxTurns ? "max_turns" : "completed",
      usage: totalUsage,
    };
  }

  estimateTokens(messages: ThreadMessage[]): number {
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
      this.responseId = options.sessionId;
      return options.sessionId;
    }
    return this.responseId ?? "pending";
  }

  async dispose(): Promise<void> {
    this.responseId = null;
  }

  async setMcpServers(servers: McpServerMap): Promise<void> {
    this.mcpServers = { ...servers };
  }

  async getMcpStatus(): Promise<McpServerStatus[]> {
    return Object.entries(this.mcpServers).map(([name, config]) => ({
      name,
      connected: false,
      transport: config.transport,
      toolCount: 0,
    }));
  }

  // ── SSE streaming ───────────────────────────────────────────────

  private async *streamRequest(
    auth: ResolvedAuth,
    input: unknown[],
    tools: ReturnType<typeof toOpenAIFunctions>,
    previousResponseId: string | null,
    options: SendOptions
  ): AsyncGenerator<SSEParsedEvent> {
    // Extract system/developer instructions from input or use default
    const instructions =
      options.systemPrompt ??
      "You are a helpful AI coding assistant. Use the provided tools to help the user.";

    const body: Record<string, unknown> = {
      model: options.model ?? this.config.model,
      instructions,
      input,
      tools,
      stream: true,
      store: false,
    };

    // previous_response_id is only valid when store=true (API key auth).
    // The ChatGPT subscription endpoint requires store=false.
    if (previousResponseId && body.store !== false) {
      body.previous_response_id = previousResponseId;
    }

    if (this.config.reasoningEffort) {
      body.reasoning = { effort: this.config.reasoningEffort };
    }

    const url = `${auth.baseUrl}/responses`;

    // Retry with exponential backoff for transient errors
    let lastError: Error | null = null;
    const delays = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, delays[attempt - 1]));
      }

      const res = await fetch(url, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastError = new Error(`API returned ${res.status}: ${await res.text()}`);
        if (attempt < delays.length) continue;
        throw lastError;
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Responses API error (${res.status}): ${errBody}`);
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      // Parse SSE stream
      yield* this.parseSSEStream(res.body);
      return;
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  private async *parseSSEStream(
    body: ReadableStream<Uint8Array>
  ): AsyncGenerator<SSEParsedEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Track partial function calls being built up across events
    const partialCalls = new Map<
      string,
      { call_id: string; name: string; arguments: string }
    >();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const eventType = String(parsed.type ?? "");

          // Text content delta
          if (eventType === "response.output_text.delta") {
            const delta = String(parsed.delta ?? "");
            if (delta) {
              yield { kind: "text_delta", text: delta };
            }
          }

          // Reasoning/thinking delta
          else if (
            eventType === "response.reasoning.delta" ||
            eventType === "response.reasoning_summary_text.delta"
          ) {
            const delta = String(parsed.delta ?? parsed.text ?? "");
            if (delta) {
              yield { kind: "reasoning_delta", text: delta };
            }
          }

          // Function call argument delta — accumulate
          else if (eventType === "response.function_call_arguments.delta") {
            const itemId = String(parsed.item_id ?? "");
            const delta = String(parsed.delta ?? "");
            const existing = partialCalls.get(itemId);
            if (existing) {
              existing.arguments += delta;
            }
          }

          // Output item added — start tracking function calls
          else if (eventType === "response.output_item.added") {
            const item = parsed.item as Record<string, unknown> | undefined;
            if (item?.type === "function_call") {
              partialCalls.set(String(item.id ?? ""), {
                id: String(item.id ?? ""),
                call_id: String(item.call_id ?? item.id ?? ""),
                name: String(item.name ?? ""),
                arguments: "",
              });
            }
          }

          // Output item done — finalize function calls
          else if (eventType === "response.output_item.done") {
            const item = parsed.item as Record<string, unknown> | undefined;
            if (item?.type === "function_call") {
              const itemId = String(item.id ?? "");
              const partial = partialCalls.get(itemId);
              const call: PendingFunctionCall = partial
                ? {
                    id: partial.id || String(item.id ?? ""),
                    call_id: partial.call_id || String(item.call_id ?? item.id ?? ""),
                    name: partial.name || String(item.name ?? ""),
                    arguments: partial.arguments || String(item.arguments ?? "{}"),
                  }
                : {
                    id: String(item.id ?? ""),
                    call_id: String(item.call_id ?? item.id ?? ""),
                    name: String(item.name ?? ""),
                    arguments: String(item.arguments ?? "{}"),
                  };
              partialCalls.delete(itemId);
              yield { kind: "function_call", call };
            }
          }

          // Response completed
          else if (
            eventType === "response.completed" ||
            eventType === "response.done"
          ) {
            const response = (parsed.response ?? parsed) as Record<
              string,
              unknown
            >;
            yield {
              kind: "response_completed",
              responseId: String(response.id ?? ""),
              usage: response.usage as SSEUsage | undefined,
            };
          }

          // Error
          else if (eventType === "error") {
            yield {
              kind: "error",
              message: String(
                (parsed.error as Record<string, unknown>)?.message ??
                  parsed.message ??
                  "Unknown SSE error"
              ),
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// ── SSE event types ───────────────────────────────────────────────

type SSEParsedEvent =
  | { kind: "text_delta"; text: string }
  | { kind: "reasoning_delta"; text: string }
  | { kind: "function_call"; call: PendingFunctionCall }
  | { kind: "response_completed"; responseId: string; usage?: SSEUsage }
  | { kind: "error"; message: string };

interface SSEUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

// ── Message conversion ────────────────────────────────────────────

/**
 * Convert ThreadMessage[] to OpenAI Responses API input format.
 */
function convertMessages(
  messages: ThreadMessage[],
  options: SendOptions
): unknown[] {
  const input: unknown[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        // System messages go into the input as a developer message
        input.push({
          role: "developer",
          content: msg.content,
        });
        break;

      case "user": {
        const content: unknown[] = [];

        // Add image attachments if present
        if (options.attachments && msg === messages[messages.length - 1]) {
          for (const att of options.attachments) {
            content.push({
              type: "input_image",
              image_url: `data:${att.mimeType};base64,${att.data}`,
            });
          }
        }

        content.push({ type: "input_text", text: msg.content });
        input.push({ role: "user", content });
        break;
      }

      case "assistant": {
        // Assistant message with potential tool calls from metadata
        const toolCalls = msg.metadata?.toolCalls as
          | Array<{
              callId: string;
              name: string;
              args: Record<string, unknown>;
              result?: unknown;
            }>
          | undefined;

        if (toolCalls && toolCalls.length > 0) {
          // Add the assistant's text as a message item
          if (msg.content) {
            input.push({
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: msg.content }],
            });
          }

          // Add function calls and their outputs
          for (const tc of toolCalls) {
            input.push({
              type: "function_call",
              id: tc.callId,
              call_id: tc.callId,
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            });
            if (tc.result !== undefined) {
              input.push({
                type: "function_call_output",
                call_id: tc.callId,
                output: String(tc.result),
              });
            }
          }
        } else if (msg.content) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: msg.content }],
          });
        }
        break;
      }
    }
  }

  return input;
}
