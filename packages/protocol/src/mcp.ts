/**
 * Provider-agnostic MCP (Model Context Protocol) server configuration types.
 *
 * These types define how MCP servers are configured in Dough.
 * Each LLM provider adapter maps these to its native MCP format.
 */

/** Stdio transport — spawns a local process */
export interface McpStdioConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** SSE transport — connects to a Server-Sent Events endpoint */
export interface McpSseConfig {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
}

/** HTTP transport — connects to an HTTP endpoint */
export interface McpHttpConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

/** Union of all MCP server transport configs */
export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig;

/** Named MCP server entry: name → config */
export type McpServerMap = Record<string, McpServerConfig>;

/** Runtime status of a connected MCP server */
export interface McpServerStatus {
  name: string;
  connected: boolean;
  transport: McpServerConfig["transport"];
  /** Number of tools exposed by this server */
  toolCount: number;
  /** List of tool names (if available) */
  tools?: string[];
  error?: string;
}
