/**
 * Adapter that wraps an existing LLMProvider as an AgentClient.
 *
 * This bridge allows the current ClaudeProvider and CodexProvider to
 * work with the new PlatformRuntime without rewriting them immediately.
 */

import type { LLMProvider, SendOptions } from "./provider.ts";
import type {
  AgentClient,
  ClientSessionState,
  ClientTurnRequest,
} from "../runtime/client.ts";

export function wrapLLMProviderAsClient(
  provider: LLMProvider,
): AgentClient {
  return {
    id: provider.name,
    name: provider.name,
    maxContextTokens: provider.maxContextTokens,

    capabilities: {
      nativeMcp: provider.supportsMcp ?? false,
      nativeSessionRestore: !!provider.createSession,
      nativeToolApproval: false,
    },

    get sessionState(): ClientSessionState | null {
      if (!provider.sessionId) return null;
      return { clientSessionId: provider.sessionId };
    },

    async createSession(options) {
      if (!provider.createSession) {
        throw new Error(`Provider "${provider.name}" does not support createSession`);
      }
      const sessionId = await provider.createSession(options);
      return { clientSessionId: sessionId };
    },

    async *runTurn(request: ClientTurnRequest) {
      const options: SendOptions = {
        model: request.model,
        systemPrompt: request.systemPrompt,
        signal: request.signal,
        attachments: request.attachments,
      };
      yield* provider.send(request.messages, options);
    },

    estimateTokens(messages) {
      return provider.estimateTokens(messages);
    },

    async dispose() {
      await provider.dispose?.();
    },

    async setMcpServers(servers) {
      await provider.setMcpServers?.(servers);
    },

    async getMcpStatus() {
      return provider.getMcpStatus?.() ?? [];
    },
  };
}
