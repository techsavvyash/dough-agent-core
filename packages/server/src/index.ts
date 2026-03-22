import { DoughAgent } from "@dough/core";
import { FileTracker } from "./file-tracker.ts";
import { createWSHandler, type WSData } from "./ws-handler.ts";
import { initDoughStorage } from "./storage.ts";

const PORT = parseInt(process.env.DOUGH_PORT ?? "4200", 10);

// Initialise persistent storage at ~/.dough before starting the server
const threadStore = await initDoughStorage();

const agent = new DoughAgent({
  provider: (process.env.DOUGH_PROVIDER as "claude" | "codex") ?? "claude",
  model: process.env.DOUGH_MODEL,
  systemPrompt: "You are Dough, a helpful AI assistant.",
  threadStore,
});

const wsHandler = createWSHandler(agent, threadStore);

const server = Bun.serve<WSData>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const success = server.upgrade(req, {
        data: {
          sessionId: url.searchParams.get("session"),
          session: null,
          fileTracker: new FileTracker(),
          sendQueue: [],
          isProcessingQueue: false,
        } satisfies WSData,
      });
      return success
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", provider: agent.getProvider().name });
    }

    // API info
    if (url.pathname === "/") {
      return Response.json({
        name: "dough-server",
        version: "0.1.0",
        ws: `ws://localhost:${PORT}/ws`,
      });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: wsHandler,
});

console.log(`🍞 Dough server running on http://localhost:${server.port}`);
console.log(`   WebSocket: ws://localhost:${server.port}/ws`);
console.log(`   Provider: ${agent.getProvider().name}`);
