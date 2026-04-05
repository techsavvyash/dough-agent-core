export { DoughAgent } from "./agent.ts";
export type { DoughAgentConfig } from "./agent.ts";
export { DoughSession } from "./session.ts";
export type { DoughSessionConfig } from "./session.ts";
export { ClaudeProvider } from "./providers/claude.ts";
export type { ClaudeProviderConfig } from "./providers/claude.ts";
export { CodexProvider } from "./providers/codex.ts";
export type { CodexProviderConfig } from "./providers/codex.ts";
export type { LLMProvider, SendOptions, ToolMiddleware } from "./providers/provider.ts";
export { ToolRegistry } from "./tools/registry.ts";
export type { ToolDefinition } from "./tools/registry.ts";
export { executeTool } from "./tools/executor.ts";
export type { ToolExecResult } from "./tools/executor.ts";
export { getBuiltinToolSchemas, toOpenAIFunctions } from "./tools/definitions.ts";
export type { BuiltinToolSchema } from "./tools/definitions.ts";
export { LLMSummaryGenerator } from "./summarizer.ts";
export { loadAgentsMd, buildAgentsContext } from "./agents-md.ts";
export type { AgentsMdEntry, AgentsMdResult, LoadOptions as AgentsMdLoadOptions } from "./agents-md.ts";
export { McpManager } from "./mcp/manager.ts";
export { SkillManager } from "./skills/manager.ts";
export { discoverSkills, loadSkill } from "./skills/loader.ts";
export { TodoManager, TodoVerifier, MemoryTodoStore, SqliteTodoStore } from "./todos/index.ts";
export type { TodoStore, CompleteResult, VerificationResult } from "./todos/index.ts";

// ── Platform Runtime ────────────────────────────────────────────
export {
  PlatformRuntime,
  EventBus,
  createToolCallEvent,
  createToolResultEvent,
  createSessionBeforeCompactEvent,
} from "./runtime/index.ts";
export type {
  PlatformRuntimeConfig,
  Notification,
  PanelOpenIntent,
  PlatformEventHandler,
  ErrorHandler,
  PlatformEvent,
  PlatformEventType,
  PlatformEventOfType,
  RuntimeExtension,
  PlatformAPI,
  RuntimeCommand,
  RuntimeShortcut,
  RuntimePanel,
  RuntimeTool,
  CommandContext,
  AgentClient,
  ClientCapabilities,
  ClientSessionState,
  ClientTurnRequest,
} from "./runtime/index.ts";
export { wrapLLMProviderAsClient } from "./providers/adapter.ts";
export {
  createGitPolicyExtension,
  createDiffCheckpointExtension,
  createSessionCommandsExtension,
  FileTracker,
} from "./runtime/index.ts";
export type {
  GitPolicyConfig,
  DiffCheckpointExtensionInstance,
  FileTrackerPersistence,
  FileTrackerOptions,
} from "./runtime/index.ts";
