/**
 * AgentClient interface — the evolved LLMProvider.
 *
 * Claude CLI, Codex CLI, or any SDK-backed engine implements this.
 * Clients are adapters under the PlatformRuntime, not the runtime itself.
 */

import type { Attachment, DoughEvent, McpServerMap, McpServerStatus } from "@dough/protocol";
import type { ThreadMessage } from "@dough/threads";

export interface ClientCapabilities {
  nativeMcp: boolean;
  nativeSessionRestore: boolean;
  nativeToolApproval: boolean;
}

export interface ClientSessionState {
  clientSessionId: string;
  [key: string]: unknown;
}

export interface ClientTurnRequest {
  messages: ThreadMessage[];
  model?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  attachments?: Attachment[];
}

export interface AgentClient {
  readonly id: string;
  readonly name: string;
  readonly maxContextTokens: number;
  readonly capabilities: ClientCapabilities;
  readonly sessionState?: ClientSessionState | null;

  createSession?(options?: {
    sessionId?: string;
    model?: string;
  }): Promise<ClientSessionState>;

  resumeSession?(state: ClientSessionState): Promise<void>;

  runTurn(request: ClientTurnRequest): AsyncGenerator<DoughEvent>;

  estimateTokens(messages: ThreadMessage[]): number | Promise<number>;

  dispose?(): Promise<void>;

  // MCP (optional, gated by capabilities.nativeMcp)
  setMcpServers?(servers: McpServerMap): Promise<void>;
  getMcpStatus?(): Promise<McpServerStatus[]>;
}
