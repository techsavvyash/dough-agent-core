/**
 * Dough Todos MCP Server
 *
 * A minimal JSON-RPC 2.0 / MCP stdio server that exposes the three
 * todo tools (TodoWrite, TodoRead, TodoComplete) to the LLM via the
 * MCP protocol.
 *
 * Launched by DoughAgent as a child process:
 *   bun run packages/core/src/todos/mcp-server.ts --db <path> --session <id>
 *
 * Arguments:
 *   --db       path to SQLite database (omit for in-memory)
 *   --session  session ID to scope todo operations
 */

import { SqliteTodoStore } from "./stores/sqlite.ts";
import { MemoryTodoStore } from "./stores/memory.ts";
import type { TodoStore } from "./store.ts";
import type {
  TodoWriteArgs,
  TodoReadArgs,
  TodoCompleteArgs,
  TodoVerification,
  TodoPriority,
} from "@dough/protocol";

// ── Arg parsing ───────────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const dbPath = getArg("db") ?? process.env.DOUGH_TODOS_DB;
const sessionId = getArg("session") ?? process.env.DOUGH_TODO_SESSION ?? "default";

const store: TodoStore = dbPath ? new SqliteTodoStore(dbPath) : new MemoryTodoStore();

// ── Tool schemas ──────────────────────────────────────────────────────────────

const TODO_WRITE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Omit to create new; provide to update existing" },
    title: { type: "string", description: "Short title for the todo" },
    description: { type: "string", description: "Optional longer description" },
    status: {
      type: "string",
      enum: ["pending", "in_progress", "done", "verified", "failed"],
      description: "Current status (defaults to pending on create)",
    },
    verification: {
      type: "object",
      description: "How to verify this todo is complete",
      properties: {
        strategy: {
          type: "string",
          enum: ["manual", "command", "file_exists", "file_contains", "test_pass", "llm_judge"],
        },
        instructions: { type: "string" },
        command: { type: "string" },
        cwd: { type: "string" },
        outputPattern: { type: "string" },
        path: { type: "string" },
        pattern: { type: "string" },
        isRegex: { type: "boolean" },
        filter: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["strategy"],
    },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "verification"],
};

const TODO_READ_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "array",
      items: {
        type: "string",
        enum: ["pending", "in_progress", "done", "verified", "failed"],
      },
      description: "Filter by status. Omit for all.",
    },
  },
};

const TODO_COMPLETE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "ID of the todo to mark complete" },
  },
  required: ["id"],
};

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function jsonResponse(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function jsonError(id: unknown, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── Tool execution ────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const now = new Date().toISOString();

  switch (name) {
    case "TodoWrite": {
      const a = args as unknown as TodoWriteArgs;
      let item;
      if (a.id) {
        const existing = await store.load(a.id);
        if (existing) {
          item = {
            ...existing,
            title: a.title ?? existing.title,
            description: a.description ?? existing.description,
            status: a.status ?? existing.status,
            verification: a.verification ?? existing.verification,
            priority: (a.priority ?? existing.priority) as TodoPriority | undefined,
            tags: a.tags ?? existing.tags,
            updatedAt: now,
          };
        } else {
          item = {
            id: a.id,
            sessionId,
            title: a.title,
            description: a.description,
            status: a.status ?? "pending" as const,
            verification: a.verification as TodoVerification,
            priority: a.priority as TodoPriority | undefined,
            tags: a.tags,
            createdAt: now,
            updatedAt: now,
          };
        }
      } else {
        item = {
          id: crypto.randomUUID(),
          sessionId,
          title: a.title,
          description: a.description,
          status: a.status ?? "pending" as const,
          verification: a.verification as TodoVerification,
          priority: a.priority as TodoPriority | undefined,
          tags: a.tags,
          createdAt: now,
          updatedAt: now,
        };
      }
      await store.save(item);
      return { success: true, todo: item };
    }

    case "TodoRead": {
      const a = args as TodoReadArgs;
      const todos = await store.list(sessionId, a.status);
      return { todos };
    }

    case "TodoComplete": {
      const a = args as unknown as TodoCompleteArgs;
      const item = await store.load(a.id);
      if (!item) return { error: `Todo not found: ${a.id}` };

      const updated = { ...item, status: "done" as const, completedAt: now, updatedAt: now };
      await store.save(updated);

      const v = item.verification;
      if (v.strategy === "manual") {
        return {
          success: true,
          todo: updated,
          message: `Todo marked done. Awaiting human verification: ${v.instructions ?? "Please review and confirm."}`,
          awaitingManualApproval: true,
        };
      }

      // Auto-verification strategies (command, file_exists, etc.) are handled
      // server-side by TodoVerifier. Return the updated item and let the server
      // run verification asynchronously.
      return {
        success: true,
        todo: updated,
        message: "Todo marked done. Verification will run automatically.",
        awaitingManualApproval: false,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP protocol handler ──────────────────────────────────────────────────────

async function handleMessage(line: string): Promise<string | null> {
  let req: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(line);
  } catch {
    return jsonError(null, -32700, "Parse error");
  }

  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      return jsonResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "dough-todos", version: "1.0.0" },
      });

    case "notifications/initialized":
      return null; // notification, no response

    case "tools/list":
      return jsonResponse(id, {
        tools: [
          {
            name: "TodoWrite",
            description: "Create a new todo or update an existing one. Each todo includes a verification strategy that defines how its completion will be validated.",
            inputSchema: TODO_WRITE_SCHEMA,
          },
          {
            name: "TodoRead",
            description: "List todos for the current session. Optionally filter by status.",
            inputSchema: TODO_READ_SCHEMA,
          },
          {
            name: "TodoComplete",
            description: "Mark a todo as done and trigger its verification flow. The verification strategy on the todo determines how completion is validated.",
            inputSchema: TODO_COMPLETE_SCHEMA,
          },
        ],
      });

    case "tools/call": {
      const toolName = (params?.name ?? "") as string;
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await executeTool(toolName, toolArgs);
        return jsonResponse(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        return jsonResponse(id, {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

const decoder = new TextDecoder();
let buffer = "";

process.stdin.on("data", async (chunk: Uint8Array) => {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const response = await handleMessage(trimmed);
    if (response !== null) {
      process.stdout.write(response + "\n");
    }
  }
});
