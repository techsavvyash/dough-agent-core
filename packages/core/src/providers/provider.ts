import type { Attachment, DoughEvent, McpServerMap, McpServerStatus } from "@dough/protocol";
import type { ThreadMessage } from "@dough/threads";

/**
 * Provider-agnostic tool middleware.
 *
 * Middleware is the canonical interception point for tool calls. Define
 * cross-cutting concerns (attribution, logging, rate-limiting, etc.) once
 * here — each provider adapter translates them to its native hook mechanism.
 *
 * Execution contract:
 *   1. The provider calls `beforeToolUse` BEFORE the tool executes.
 *   2. If `beforeToolUse` returns a new input record, the provider MUST use
 *      that modified input instead of the original.
 *   3. Returning `void`/`undefined` means "pass through unchanged".
 */
export interface ToolMiddleware {
  /**
   * Optional tool name filter (e.g. "Bash", "Write").
   * If omitted, the middleware is applied to every tool call.
   */
  toolName?: string;

  /**
   * Called BEFORE the tool executes.
   * Return a new input record to rewrite the tool's arguments,
   * or return void/undefined to pass the original through unchanged.
   */
  beforeToolUse?(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown> | void>;
}

export interface SendOptions {
  model?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  /**
   * Provider-agnostic tool middleware applied before tool execution.
   * Each provider translates these into its native hook mechanism.
   * Middleware is applied in array order; the output of one is NOT
   * chained as input to the next (they run independently).
   */
  toolMiddleware?: ToolMiddleware[];
  /**
   * Optional image attachments to include with the user message.
   * Each provider maps these to its native multimodal format.
   */
  attachments?: Attachment[];
}

/**
 * LLM provider abstraction. Implement this to add support
 * for any LLM backend (Claude, Codex, Gemini, local models, etc.)
 */
export interface LLMProvider {
  readonly name: string;
  readonly maxContextTokens: number;

  /**
   * Send messages and stream back events.
   * The provider maps its native events to DoughEvent format.
   */
  send(
    messages: ThreadMessage[],
    options: SendOptions
  ): AsyncGenerator<DoughEvent>;

  /**
   * Estimate token count for a set of messages.
   */
  estimateTokens(messages: ThreadMessage[]): number | Promise<number>;

  /**
   * The provider-native session ID, if any. Used to persist and restore
   * the provider's own session state (e.g. claude-agent-sdk session_id).
   */
  readonly sessionId?: string | null;

  /**
   * Create or resume a provider-native session.
   * Returns a session ID that can be used with the provider's own persistence.
   */
  createSession?(options?: {
    sessionId?: string;
    model?: string;
  }): Promise<string>;

  /**
   * Clean up provider resources.
   */
  dispose?(): Promise<void>;

  // ── MCP support (optional) ─────────────────────────────────

  /**
   * Whether this provider supports MCP servers natively.
   * When true, setMcpServers/getMcpStatus are expected to work.
   */
  readonly supportsMcp?: boolean;

  /**
   * Configure MCP servers for this provider.
   * The provider adapter maps generic McpServerConfig to its native format.
   */
  setMcpServers?(servers: McpServerMap): Promise<void>;

  /**
   * Get the status of all configured MCP servers.
   */
  getMcpStatus?(): Promise<McpServerStatus[]>;
}
