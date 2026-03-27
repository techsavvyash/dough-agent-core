import { DoughAgent, SqliteTodoStore } from "@dough/core";
import { FileTracker } from "./file-tracker.ts";
import { createWSHandler, type WSData } from "./ws-handler.ts";
import { initDoughStorage, getDoughDir } from "./storage.ts";
import { join } from "node:path";

const PORT = parseInt(process.env.DOUGH_PORT ?? "4200", 10);

// Initialise persistent storage at ~/.dough before starting the server
const threadStore = await initDoughStorage();
const doughDir = await getDoughDir();
const todoStore = new SqliteTodoStore(join(doughDir, "todos.db"));

const agent = new DoughAgent({
  provider: (process.env.DOUGH_PROVIDER as "claude" | "codex") ?? "claude",
  model: process.env.DOUGH_MODEL,
  systemPrompt: "You are Dough, a helpful AI assistant.",
  threadStore,
  todoStore,
});

// threadStore is HybridThreadStore — it implements both ThreadStore and FileDiffStore
const wsHandler = createWSHandler(agent, threadStore, threadStore);

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
          sendQueue: [] as { prompt: string; attachments?: import("@dough/protocol").Attachment[] }[],
          isProcessingQueue: false,
          pendingManualVerifications: new Map(),
        } satisfies WSData,
      });
      return success
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", provider: agent.getProvider().name, cwd: agent.getCwd() });
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
