import {
  ThreadManager,
  MemoryThreadStore,
  type TokenCounter,
  type SummaryGenerator,
  type ThreadMessage,
  type ThreadStore,
} from "@dough/threads";

import { DoughSession } from "./session.ts";
import type { LLMProvider, ToolMiddleware } from "./providers/provider.ts";
import { ClaudeProvider, type ClaudeProviderConfig } from "./providers/claude.ts";
import { CodexProvider, type CodexProviderConfig } from "./providers/codex.ts";
import { buildAgentsContext } from "./agents-md.ts";
import { LLMSummaryGenerator } from "./summarizer.ts";
import { McpManager } from "./mcp/manager.ts";
import { SkillManager } from "./skills/manager.ts";
import type { McpServerMap } from "@dough/protocol";
import { createAttributionMiddleware } from "./git-attribution.ts";
import { TodoManager } from "./todos/manager.ts";
import { TodoVerifier } from "./todos/verifier.ts";
import type { TodoStore } from "./todos/store.ts";
import { PlatformRuntime } from "./runtime/runtime.ts";
import { wrapLLMProviderAsClient } from "./providers/adapter.ts";
import { createGitPolicyExtension } from "./runtime/extensions/git-policy.ts";
import { createDiffCheckpointExtension } from "./runtime/extensions/diff-checkpoint.ts";
import { createSessionCommandsExtension } from "./runtime/extensions/session-commands.ts";

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
  /** Codex-specific config passed through to CodexProvider */
  codex?: Omit<CodexProviderConfig, "model">;
  /** MCP servers to configure at startup */
  mcpServers?: McpServerMap;
  /** Set false to skip discovering skills. Defaults to true. */
  loadSkills?: boolean;
  /**
   * Additional tool middleware to apply beyond the platform defaults.
   * Dough always applies attribution middleware; this lets callers add more.
   */
  toolMiddleware?: ToolMiddleware[];
  /** Optional todo store. When provided, enables the TodoManager feature. */
  todoStore?: TodoStore;
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
  private todoManager: TodoManager | null = null;
  private config: DoughAgentConfig;
  private agentsContext: string | null = null;
  private agentsContextPromise: Promise<string> | null = null;
  private skillsDiscoveryPromise: Promise<void> | null = null;
  /**
   * Resolved tool middleware: platform defaults (attribution) + any caller-
   * supplied additions. Immutable after construction — shared across all sessions
   * created by this agent.
   */
  private readonly toolMiddleware: ToolMiddleware[];
  private readonly runtime: PlatformRuntime;
  private runtimeInitPromise: Promise<void> | null = null;

  constructor(config: DoughAgentConfig) {
    this.config = config;

    // Attribution middleware hooks into the Claude SDK's PreToolUse, modifying
    // tool input BEFORE execution. The git-policy extension's tool:call rewrite
    // only changes the yielded event, not what the SDK actually runs. Both layers
    // are needed until runtime events can feed back into the SDK's hook system.
    this.toolMiddleware = [
      createAttributionMiddleware(),
      ...(config.toolMiddleware ?? []),
    ];

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
          this.provider = new CodexProvider({
            model: config.model,
            cwd: config.cwd,
            ...config.codex,
          });
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

    // Set up todos if a store is provided
    if (config.todoStore) {
      const verifier = new TodoVerifier(this.provider);
      this.todoManager = new TodoManager(config.todoStore, verifier);

      // Register the todos MCP server so the LLM can call TodoWrite/TodoRead/TodoComplete.
      // The server script is co-located in this package; env vars pass the db path.
      // Session ID is "default" at agent level; the WS handler calls
      // runtime.setSession() with the real session ID when one is established.
      const mcpServerPath = import.meta.dirname + "/todos/mcp-server.ts";
      // Derive the db path from the store if it's a SqliteTodoStore (has a dbPath prop)
      const dbPath =
        (config.todoStore as unknown as { dbPath?: string }).dbPath ?? "";
      this.mcpManager.add("dough_todos", {
        transport: "stdio",
        command: "bun",
        args: ["run", mcpServerPath],
        env: {
          ...(dbPath ? { DOUGH_TODOS_DB: dbPath } : {}),
          DOUGH_TODO_SESSION: "default",
        },
      });
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

    // Create the platform runtime and register the provider as a client.
    // Built-in extensions are registered here; initialization happens lazily
    // on the first session() call so async setup can complete.
    this.runtime = new PlatformRuntime({ cwd: config.cwd });
    this.runtime.registerClient(wrapLLMProviderAsClient(this.provider));

    // Register built-in extensions
    this.runtime.registerExtension(createGitPolicyExtension());
    this.runtime.registerExtension(createDiffCheckpointExtension());
    this.runtime.registerExtension(createSessionCommandsExtension());
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

  private async ensureRuntimeInitialized(): Promise<void> {
    if (!this.runtimeInitPromise) {
      this.runtimeInitPromise = this.runtime.initialize();
    }
    await this.runtimeInitPromise;
  }

  async session(options?: { id?: string }): Promise<DoughSession> {
    const sessionId = options?.id ?? crypto.randomUUID();
    const systemPrompt = await this.resolveSystemPrompt();
    await this.ensureRuntimeInitialized();

    return new DoughSession(sessionId, {
      provider: this.provider,
      threadManager: this.threadManager,
      systemPrompt,
      model: this.config.model,
      toolMiddleware: this.toolMiddleware,
      runtime: this.runtime,
    });
  }

  /**
   * Reconstruct a previously-saved session without creating a new thread.
   * Used when resuming after a server restart — the thread history is still
   * in the persistent store; we just need to point the session at it.
   *
   * @param providerSessionId  Optional provider-native session ID (e.g. the
   *   claude-agent-sdk session_id). When supplied, the provider is told to
   *   resume from that SDK session so it has full conversation history.
   */
  async resumeSession(
    sessionId: string,
    activeThreadId: string,
    providerSessionId?: string
  ): Promise<DoughSession> {
    const systemPrompt = await this.resolveSystemPrompt();
    await this.ensureRuntimeInitialized();

    // Restore the provider-native session ID so the next query() call
    // passes `resume: <id>` and the SDK reloads the full conversation.
    if (providerSessionId && this.provider.createSession) {
      await this.provider.createSession({ sessionId: providerSessionId });
    }

    const session = new DoughSession(sessionId, {
      provider: this.provider,
      threadManager: this.threadManager,
      systemPrompt,
      model: this.config.model,
      toolMiddleware: this.toolMiddleware,
      runtime: this.runtime,
    });
    session.resumeThread(activeThreadId);
    return session;
  }

  getRuntime(): PlatformRuntime {
    return this.runtime;
  }

  getThreadManager(): ThreadManager {
    return this.threadManager;
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  /**
   * Hot-swap the active LLM provider at runtime.
   * Updates the runtime client registration so extensions see the new provider.
   */
  setProvider(newProvider: LLMProvider): void {
    this.provider = newProvider;
    this.runtime.registerClient(wrapLLMProviderAsClient(newProvider));
  }

  /**
   * Change the active model. Takes effect on the next provider query.
   */
  setModel(model: string): void {
    this.config.model = model;
  }

  /** Get the currently configured model alias. */
  getModel(): string | undefined {
    return this.config.model;
  }

  /**
   * Create a provider instance by name, using the current agent config.
   */
  createProvider(name: "claude" | "codex"): LLMProvider {
    switch (name) {
      case "claude":
        return new ClaudeProvider({
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          ...this.config.claude,
        });
      case "codex":
        return new CodexProvider({
          model: this.config.model,
          cwd: this.config.cwd,
          ...this.config.codex,
        });
      default:
        throw new Error(`Unknown provider: ${name}`);
    }
  }

  getMcpManager(): McpManager {
    return this.mcpManager;
  }

  getSkillManager(): SkillManager {
    return this.skillManager;
  }

  getTodoManager(): TodoManager | null {
    return this.todoManager;
  }

  getCwd(): string {
    return this.config.cwd ?? process.cwd();
  }
}
