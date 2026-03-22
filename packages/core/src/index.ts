export { DoughAgent } from "./agent.ts";
export type { DoughAgentConfig } from "./agent.ts";
export { DoughSession } from "./session.ts";
export type { DoughSessionConfig } from "./session.ts";
export { ClaudeProvider } from "./providers/claude.ts";
export type { ClaudeProviderConfig } from "./providers/claude.ts";
export { CodexProvider } from "./providers/codex.ts";
export type { LLMProvider, SendOptions } from "./providers/provider.ts";
export { ToolRegistry } from "./tools/registry.ts";
export type { ToolDefinition } from "./tools/registry.ts";
export { LLMSummaryGenerator } from "./summarizer.ts";
export { loadAgentsMd, buildAgentsContext } from "./agents-md.ts";
export type { AgentsMdEntry, AgentsMdResult, LoadOptions as AgentsMdLoadOptions } from "./agents-md.ts";
export { McpManager } from "./mcp/manager.ts";
export { SkillManager } from "./skills/manager.ts";
export { discoverSkills, loadSkill } from "./skills/loader.ts";
export {
  ATTRIBUTION_TRAILER,
  isGitCommitCommand,
  appendAttributionTrailer,
} from "./git-attribution.ts";
