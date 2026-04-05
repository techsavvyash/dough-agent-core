import { describe, test, expect } from "bun:test";
import { CodexProvider } from "../codex.ts";
import { DoughEventType } from "@dough/protocol";

describe("CodexProvider", () => {
  test("instantiates with default config", () => {
    const provider = new CodexProvider();
    expect(provider.name).toBe("codex");
    expect(provider.maxContextTokens).toBe(200_000);
    expect(provider.sessionId).toBeNull();
  });

  test("estimateTokens returns rough estimate", () => {
    const provider = new CodexProvider();
    const tokens = provider.estimateTokens([
      { id: "1", role: "user", content: "Hello world", createdAt: Date.now() },
    ]);
    expect(tokens).toBeGreaterThan(0);
  });

  test("createSession stores sessionId", async () => {
    const provider = new CodexProvider();
    const id = await provider.createSession({ sessionId: "test-123" });
    expect(id).toBe("test-123");
    expect(provider.sessionId).toBe("test-123");
  });

  test("dispose clears sessionId", async () => {
    const provider = new CodexProvider();
    await provider.createSession({ sessionId: "test-123" });
    await provider.dispose();
    expect(provider.sessionId).toBeNull();
  });

  test("send yields error when no auth configured", async () => {
    // No API key, no OAuth — should yield a clear error
    const provider = new CodexProvider({
      apiKey: undefined,
      oauthCredentialsPath: "/tmp/nonexistent-dough-auth.json",
    });

    // Temporarily clear env var
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const events: Array<{ type: string; message?: string }> = [];
    for await (const event of provider.send(
      [{ id: "1", role: "user", content: "hi", createdAt: Date.now() }],
      {}
    )) {
      events.push(event as any);
    }

    // Restore
    if (origKey) process.env.OPENAI_API_KEY = origKey;

    expect(events.length).toBeGreaterThan(0);
    const errorEvent = events.find((e) => e.type === DoughEventType.Error);
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).toContain("No OpenAI auth configured");
  });

  test("getMcpStatus returns empty array by default", async () => {
    const provider = new CodexProvider();
    const status = await provider.getMcpStatus();
    expect(status).toEqual([]);
  });
});
