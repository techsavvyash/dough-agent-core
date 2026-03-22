import { test, expect, describe, beforeEach } from "bun:test";
import { McpManager } from "./manager.ts";
import type { LLMProvider } from "../providers/provider.ts";
import type { McpServerMap, McpServerStatus } from "@dough/protocol";

/** Mock provider that records setMcpServers calls */
function createMockProvider(opts: { supportsMcp?: boolean } = {}): LLMProvider & {
  lastMcpServers: McpServerMap | null;
  setCount: number;
  statusResult: McpServerStatus[];
} {
  const mock = {
    name: "mock",
    maxContextTokens: 200_000,
    supportsMcp: opts.supportsMcp ?? true,
    lastMcpServers: null as McpServerMap | null,
    setCount: 0,
    statusResult: [] as McpServerStatus[],
    async *send() {},
    estimateTokens: () => 0,
    async setMcpServers(servers: McpServerMap) {
      mock.lastMcpServers = servers;
      mock.setCount++;
    },
    async getMcpStatus(): Promise<McpServerStatus[]> {
      return mock.statusResult;
    },
  };
  return mock;
}

describe("McpManager", () => {
  let provider: ReturnType<typeof createMockProvider>;
  let mcp: McpManager;

  beforeEach(() => {
    provider = createMockProvider();
    mcp = new McpManager(provider);
  });

  test("starts with no servers", () => {
    expect(mcp.list()).toHaveLength(0);
    expect(mcp.has("foo")).toBe(false);
  });

  test("add pushes config to provider", async () => {
    await mcp.add("github", {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    });

    expect(mcp.list()).toEqual(["github"]);
    expect(mcp.has("github")).toBe(true);
    expect(provider.setCount).toBe(1);
    expect(provider.lastMcpServers).toHaveProperty("github");
    expect(provider.lastMcpServers!.github.transport).toBe("stdio");
  });

  test("remove deletes server and syncs", async () => {
    await mcp.add("s1", { transport: "stdio", command: "cmd1" });
    await mcp.add("s2", { transport: "stdio", command: "cmd2" });
    expect(mcp.list()).toHaveLength(2);

    await mcp.remove("s1");
    expect(mcp.list()).toEqual(["s2"]);
    expect(provider.lastMcpServers).not.toHaveProperty("s1");
    expect(provider.lastMcpServers).toHaveProperty("s2");
  });

  test("setAll replaces all servers", async () => {
    await mcp.add("old", { transport: "stdio", command: "old-cmd" });

    await mcp.setAll({
      new1: { transport: "http", url: "http://localhost:3000" },
      new2: { transport: "sse", url: "http://localhost:3001" },
    });

    expect(mcp.list()).toEqual(["new1", "new2"]);
    expect(mcp.has("old")).toBe(false);
  });

  test("getConfig returns current config", async () => {
    await mcp.add("test", { transport: "stdio", command: "test-cmd", args: ["--flag"] });
    const config = mcp.getConfig();
    expect(config.test).toEqual({
      transport: "stdio",
      command: "test-cmd",
      args: ["--flag"],
    });
  });

  test("status delegates to provider.getMcpStatus", async () => {
    provider.statusResult = [
      { name: "github", connected: true, transport: "stdio", toolCount: 5 },
    ];
    const status = await mcp.status();
    expect(status).toHaveLength(1);
    expect(status[0].name).toBe("github");
    expect(status[0].toolCount).toBe(5);
  });

  test("status returns synthetic data for providers without getMcpStatus", async () => {
    // Create provider without getMcpStatus
    const bareProvider: LLMProvider = {
      name: "bare",
      maxContextTokens: 100_000,
      async *send() {},
      estimateTokens: () => 0,
    };
    const bareMcp = new McpManager(bareProvider);
    await bareMcp.add("test", { transport: "http", url: "http://test.com" });

    const status = await bareMcp.status();
    expect(status).toHaveLength(1);
    expect(status[0].name).toBe("test");
    expect(status[0].transport).toBe("http");
    expect(status[0].connected).toBe(true);
  });

  test("supports all transport types", async () => {
    await mcp.setAll({
      stdio: { transport: "stdio", command: "npx", args: ["server"], env: { TOKEN: "abc" } },
      sse: { transport: "sse", url: "http://sse.example.com", headers: { Authorization: "Bearer x" } },
      http: { transport: "http", url: "http://api.example.com" },
    });

    expect(mcp.list()).toHaveLength(3);
    const config = mcp.getConfig();
    expect(config.stdio.transport).toBe("stdio");
    expect(config.sse.transport).toBe("sse");
    expect(config.http.transport).toBe("http");
  });

  test("each mutation triggers a sync", async () => {
    expect(provider.setCount).toBe(0);

    await mcp.add("a", { transport: "stdio", command: "a" });
    expect(provider.setCount).toBe(1);

    await mcp.add("b", { transport: "stdio", command: "b" });
    expect(provider.setCount).toBe(2);

    await mcp.remove("a");
    expect(provider.setCount).toBe(3);

    await mcp.setAll({});
    expect(provider.setCount).toBe(4);
  });
});
