import {
  ThreadManager,
  MemoryThreadStore,
  type TokenCounter,
  type SummaryGenerator,
  type ThreadMessage,
  type ThreadStore,
} from "@dough/threads";
import { DoughSession } from "./session.ts";
import type { LLMProvider } from "./providers/provider.ts";
import { ClaudeProvider, type ClaudeProviderConfig } from "./providers/claude.ts";
import { CodexProvider } from "./providers/codex.ts";

export interface DoughAgentConfig {
  provider: "claude" | "codex" | LLMProvider;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  threadStore?: ThreadStore;
  tokenCounter?: TokenCounter;
  summaryGenerator?: SummaryGenerator;
  /** Claude-specific config passed through to ClaudeProvider */
  claude?: Omit<ClaudeProviderConfig, "model" | "systemPrompt">;
}

/**
 * Simple word-based token counter (fallback).
 */
const defaultTokenCounter: TokenCounter = {
  count(messages: ThreadMessage[]): number {
    return messages.reduce(
      (sum, msg) => sum + Math.ceil(msg.content.length / 4),
      0
    );
  },
};

/**
 * Placeholder summary generator — extracts last N messages.
 * In production, this should use the LLM to generate summaries.
 */
const defaultSummaryGenerator: SummaryGenerator = {
  async summarize(messages: ThreadMessage[]): Promise<string> {
    const recent = messages.slice(-20);
    return recent
      .map((m) => `[${m.role}]: ${m.content.slice(0, 500)}`)
      .join("\n\n");
  },
};

/**
 * DoughAgent is the main factory for creating sessions.
 * Configure it with a provider, then call session() to start conversations.
 */
export class DoughAgent {
  private provider: LLMProvider;
  private threadManager: ThreadManager;
  private config: DoughAgentConfig;

  constructor(config: DoughAgentConfig) {
    this.config = config;

    // Resolve provider
    if (typeof config.provider === "string") {
      switch (config.provider) {
        case "claude":
          this.provider = new ClaudeProvider({
            model: config.model,
            systemPrompt: config.systemPrompt,
            ...config.claude,
          });
          break;
        case "codex":
          this.provider = new CodexProvider({ model: config.model });
          break;
        default:
          throw new Error(`Unknown provider: ${config.provider}`);
      }
    } else {
      this.provider = config.provider;
    }

    // Create thread manager
    const tmConfig = ThreadManager.createConfig({
      maxTokens: config.maxTokens ?? 200_000,
      store: config.threadStore ?? new MemoryThreadStore(),
      tokenCounter: config.tokenCounter ?? defaultTokenCounter,
      summaryGenerator: config.summaryGenerator ?? defaultSummaryGenerator,
    });
    this.threadManager = new ThreadManager(tmConfig);
  }

  session(options?: { id?: string }): DoughSession {
    const sessionId = options?.id ?? crypto.randomUUID();
    return new DoughSession(sessionId, {
      provider: this.provider,
      threadManager: this.threadManager,
      systemPrompt: this.config.systemPrompt,
      model: this.config.model,
    });
  }

  getThreadManager(): ThreadManager {
    return this.threadManager;
  }

  getProvider(): LLMProvider {
    return this.provider;
  }
}
