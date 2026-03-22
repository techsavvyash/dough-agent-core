import type { DoughEvent, McpServerMap, McpServerStatus } from "@dough/protocol";
import type { ThreadMessage } from "@dough/threads";

export interface SendOptions {
  model?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
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
