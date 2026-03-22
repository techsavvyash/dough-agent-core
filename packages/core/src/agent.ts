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
import { buildAgentsContext } from "./agents-md.ts";
import { LLMSummaryGenerator } from "./summarizer.ts";
import { McpManager } from "./mcp/manager.ts";
import { SkillManager } from "./skills/manager.ts";
import type { McpServerMap } from "@dough/protocol";

export interface DoughAgentConfig {
  provider: "claude" | "codex" | LLMProvider;
  model?: string;
  systemPrompt?: string;
  /** Working directory for AGENTS.md discovery. Defaults to process.cwd(). */
  cwd?: string;
  /** Set false to skip loading AGENTS.md files. Defaults to true. */
  loadAgentsMd?: boolean;
  maxTokens?: number;
  threadStore?: ThreadStore;
  tokenCounter?: TokenCounter;
  summaryGenerator?: SummaryGenerator;
  /** Claude-specific config passed through to ClaudeProvider */
  claude?: Omit<ClaudeProviderConfig, "model" | "systemPrompt">;
  /** MCP servers to configure at startup */
  mcpServers?: McpServerMap;
  /** Set false to skip discovering skills. Defaults to true. */
  loadSkills?: boolean;
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
 * DoughAgent is the main factory for creating sessions.
 * Configure it with a provider, then call session() to start conversations.
 *
 * Automatically discovers and loads AGENTS.md files from the working
 * directory up to the git root, merging them into the system prompt.
 */
export class DoughAgent {
  private provider: LLMProvider;
  private threadManager: ThreadManager;
  private mcpManager: McpManager;
  private skillManager: SkillManager;
  private config: DoughAgentConfig;
  private agentsContext: string | null = null;
  private agentsContextPromise: Promise<string> | null = null;
  private skillsDiscoveryPromise: Promise<void> | null = null;

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
      summaryGenerator:
        config.summaryGenerator ?? new LLMSummaryGenerator(this.provider),
    });
    this.threadManager = new ThreadManager(tmConfig);

    // Create MCP manager
    this.mcpManager = new McpManager(this.provider);
    if (config.mcpServers) {
      this.mcpManager.setAll(config.mcpServers);
    }

    // Create skill manager and discover skills in background
    this.skillManager = new SkillManager(config.cwd);
    if (config.loadSkills !== false) {
      this.skillsDiscoveryPromise = this.skillManager.discover().then(() => {});
    }

    // Start loading AGENTS.md in the background.
    // When using Claude provider, skip CLAUDE.md fallback since
    // claude-agent-sdk already discovers and injects CLAUDE.md natively.
    if (config.loadAgentsMd !== false) {
      const skipClaudeMd = this.provider.name === "claude";
      this.agentsContextPromise = buildAgentsContext(config.cwd, { skipClaudeMd }).then((ctx) => {
        this.agentsContext = ctx;
        return ctx;
      });
    }
  }

  /**
   * Build the full system prompt by combining AGENTS.md context
   * with any user-provided system prompt.
   */
  private async resolveSystemPrompt(): Promise<string | undefined> {
    // Wait for AGENTS.md loading if still in progress
    if (this.agentsContext === null && this.agentsContextPromise) {
      await this.agentsContextPromise;
    }
    // Wait for skills discovery if still in progress
    if (this.skillsDiscoveryPromise) {
      await this.skillsDiscoveryPromise;
    }

    const parts: string[] = [];
    if (this.agentsContext) parts.push(this.agentsContext);
    if (this.config.systemPrompt) parts.push(this.config.systemPrompt);

    // Inject skills context (catalog + any pre-activated skills)
    const skillsContext = this.skillManager.buildContext();
    if (skillsContext) parts.push(skillsContext);

    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  async session(options?: { id?: string }): Promise<DoughSession> {
    const sessionId = options?.id ?? crypto.randomUUID();
    const systemPrompt = await this.resolveSystemPrompt();

    return new DoughSession(sessionId, {
      provider: this.provider,
      threadManager: this.threadManager,
      systemPrompt,
      model: this.config.model,
    });
  }

  getThreadManager(): ThreadManager {
    return this.threadManager;
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  getMcpManager(): McpManager {
    return this.mcpManager;
  }

  getSkillManager(): SkillManager {
    return this.skillManager;
  }
}
