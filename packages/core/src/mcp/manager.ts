import type {
  McpServerConfig,
  McpServerMap,
  McpServerStatus,
} from "@dough/protocol";
import type { LLMProvider } from "../providers/provider.ts";

/**
 * McpManager coordinates MCP servers across any LLM provider.
 *
 * It holds the desired server configuration and delegates
 * to the provider's native MCP adapter (claude-agent-sdk,
 * codex-sdk, or a generic fallback).
 *
 * Usage:
 *   const mcp = new McpManager(provider);
 *   await mcp.add("github", { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] });
 *   await mcp.add("fs", { transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] });
 *   const status = await mcp.status();
 */
export class McpManager {
  private servers: McpServerMap = {};
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  /**
   * Add an MCP server and push the updated config to the provider.
   */
  async add(name: string, config: McpServerConfig): Promise<void> {
    this.servers[name] = config;
    await this.sync();
  }

  /**
   * Remove an MCP server by name.
   */
  async remove(name: string): Promise<void> {
    delete this.servers[name];
    await this.sync();
  }

  /**
   * Replace all MCP servers at once.
   */
  async setAll(servers: McpServerMap): Promise<void> {
    this.servers = { ...servers };
    await this.sync();
  }

  /**
   * Get the current desired configuration.
   */
  getConfig(): Readonly<McpServerMap> {
    return this.servers;
  }

  /**
   * Get the names of all configured servers.
   */
  list(): string[] {
    return Object.keys(this.servers);
  }

  /**
   * Check whether an MCP server is configured.
   */
  has(name: string): boolean {
    return name in this.servers;
  }

  /**
   * Get runtime status of all MCP servers from the provider.
   * Falls back to a synthetic status if the provider doesn't support native MCP.
   */
  async status(): Promise<McpServerStatus[]> {
    if (this.provider.getMcpStatus) {
      return this.provider.getMcpStatus();
    }
    // Synthetic status for providers without native MCP status reporting
    return Object.entries(this.servers).map(([name, config]) => ({
      name,
      connected: true, // optimistic — we don't know the real state
      transport: config.transport,
      toolCount: 0,
    }));
  }

  /**
   * Push the current server map to the provider.
   */
  private async sync(): Promise<void> {
    if (this.provider.setMcpServers) {
      await this.provider.setMcpServers(this.servers);
    }
  }
}
