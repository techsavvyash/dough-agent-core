/**
 * Live integration test for the Todo tool system.
 *
 * Tests:
 *   1. WebSocket connect → create session → todos_list (empty)
 *   2. TodoManager directly: write → read → complete (file_exists strategy)
 *   3. TodoManager: complete with command strategy (bun --version)
 *   4. WebSocket todos_list after writes → todos_update with items
 *   5. MCP server smoke test: spawn process, send tools/list, verify tool names
 *
 * Run with:
 *   bun run scripts/test-todos.ts <server-port>
 */

import { SqliteTodoStore } from "../packages/core/src/todos/stores/sqlite.ts";
import { MemoryTodoStore } from "../packages/core/src/todos/stores/memory.ts";
import { TodoManager } from "../packages/core/src/todos/manager.ts";
import { TodoVerifier } from "../packages/core/src/todos/verifier.ts";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const PORT = parseInt(process.argv[2] ?? "4299", 10);

const PASS = "✅";
const FAIL = "❌";

let passed = 0;
let failed = 0;

function ok(label: string, value: boolean, detail?: string) {
  if (value) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. WebSocket: connect → create → todos_list
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📡  Test 1: WebSocket connect + session create + todos_list");

async function wsTest(): Promise<void> {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const messages: unknown[] = [];
  let sessionId: string | null = null;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WS timeout")), 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ kind: "create", provider: "claude" }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      messages.push(msg);
      if (msg.kind === "session_info") {
        sessionId = msg.session.id;
        // Now request todos
        ws.send(JSON.stringify({ kind: "todos_list", sessionId }));
      }
      if (msg.kind === "todos_update") {
        clearTimeout(timer);
        resolve();
      }
      if (msg.kind === "error" && msg.code === "TODOS_DISABLED") {
        clearTimeout(timer);
        reject(new Error("TODOS_DISABLED — todoStore not wired into server"));
      }
    };
    ws.onerror = () => reject(new Error("WS error"));
  }).finally(() => ws.close());

  const sessionMsg = messages.find((m: any) => m.kind === "session_info");
  const todosMsg = messages.find((m: any) => m.kind === "todos_update");

  ok("session_info received", !!sessionMsg);
  ok("todos_update received", !!todosMsg);
  ok("initial todos array is empty", Array.isArray((todosMsg as any)?.todos) && (todosMsg as any).todos.length === 0);
}

try {
  await wsTest();
} catch (e) {
  ok("WebSocket test", false, (e as Error).message);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. TodoManager unit: write → read → complete (file_exists)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📝  Test 2: TodoManager — write / read / complete (file_exists)");

const tmpDir = await mkdtemp(join(tmpdir(), "dough-todo-test-"));
const testFile = join(tmpDir, "proof.txt");

try {
  const store = new MemoryTodoStore();
  const verifier = new TodoVerifier({ name: "mock", maxContextTokens: 0, send: async function*() {}, estimateTokens: () => 0 } as any);
  const manager = new TodoManager(store, verifier);

  const item = await manager.write({
    title: "Create proof.txt",
    verification: { strategy: "file_exists", path: testFile },
  }, "test-session");

  ok("todo created with pending status", item.status === "pending");
  ok("todo has correct title", item.title === "Create proof.txt");

  // Read before file exists
  const result1 = await manager.complete({ id: item.id }, "test-session");
  ok("verification fails before file exists", result1.item.status === "failed");
  ok("verificationDetails populated", !!result1.item.verificationDetails);

  // Now create the file
  await writeFile(testFile, "done!");

  // Reset and try again
  const item2 = await manager.write({
    title: "Create proof.txt (retry)",
    verification: { strategy: "file_exists", path: testFile },
  }, "test-session");

  const result2 = await manager.complete({ id: item2.id }, "test-session");
  ok("verification passes after file exists", result2.item.status === "verified");
  ok("verifiedAt is set", !!result2.item.verifiedAt);

} catch (e) {
  ok("TodoManager file_exists test", false, (e as Error).message);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TodoManager: complete with command strategy (bun --version)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n⚙️   Test 3: TodoManager — command strategy (bun --version)");

try {
  const store = new MemoryTodoStore();
  const verifier = new TodoVerifier({ name: "mock", maxContextTokens: 0, send: async function*() {}, estimateTokens: () => 0 } as any);
  const manager = new TodoManager(store, verifier);

  const item = await manager.write({
    title: "Check bun version",
    verification: { strategy: "command", command: "bun --version", outputPattern: "^\\d" },
  }, "test-session");

  const result = await manager.complete({ id: item.id }, "test-session");
  ok("bun --version command passes", result.item.status === "verified", result.item.verificationDetails);

} catch (e) {
  ok("TodoManager command test", false, (e as Error).message);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TodoManager: manual strategy → awaitingManualApproval
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n🙋  Test 4: TodoManager — manual verification strategy");

try {
  const store = new MemoryTodoStore();
  const verifier = new TodoVerifier({ name: "mock", maxContextTokens: 0, send: async function*() {}, estimateTokens: () => 0 } as any);
  const manager = new TodoManager(store, verifier);

  const item = await manager.write({
    title: "Deploy to production",
    verification: { strategy: "manual", instructions: "Check deployment dashboard is green" },
  }, "test-session");

  const result = await manager.complete({ id: item.id }, "test-session");
  ok("manual → awaitingManualApproval = true", result.awaitingManualApproval);
  ok("status stays 'done' while awaiting", result.item.status === "done");

  // Simulate human approval
  const final = await manager.finalizeManualVerification(item.id, true);
  ok("after approval → status = verified", final.status === "verified");
  ok("verificationDetails = 'Manually approved'", final.verificationDetails === "Manually approved");

} catch (e) {
  ok("TodoManager manual test", false, (e as Error).message);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. SQLite store persistence
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n💾  Test 5: SqliteTodoStore persistence");

try {
  const dbPath = join(tmpDir, "todos.db");
  const store1 = new SqliteTodoStore(dbPath);
  const now = new Date().toISOString();

  await store1.save({
    id: "todo-sqlite-1",
    sessionId: "sess-1",
    title: "Persistent todo",
    status: "pending",
    verification: { strategy: "manual" },
    createdAt: now,
    updatedAt: now,
  });

  // Re-open store (simulates restart)
  const store2 = new SqliteTodoStore(dbPath);
  const loaded = await store2.load("todo-sqlite-1");
  ok("todo persists across store re-open", loaded?.title === "Persistent todo");
  ok("verification strategy preserved", loaded?.verification.strategy === "manual");

  const list = await store2.list("sess-1");
  ok("list returns 1 item for session", list.length === 1);

  const listOther = await store2.list("sess-other");
  ok("list returns 0 items for other session", listOther.length === 0);

} catch (e) {
  ok("SqliteTodoStore test", false, (e as Error).message);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. MCP server smoke test
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n🔌  Test 6: MCP server — tools/list via stdio");

try {
  const mcpPath = new URL("../packages/core/src/todos/mcp-server.ts", import.meta.url).pathname;
  const proc = Bun.spawn(["bun", "run", mcpPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const initMsg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n";
  const listMsg = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n";

  proc.stdin.write(initMsg);
  proc.stdin.write(listMsg);
  proc.stdin.flush();

  // Read lines until we have both responses, with a timeout
  const lines: string[] = [];
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  await Promise.race([
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const part of parts) if (part.trim()) lines.push(part.trim());
        // Stop once we have both responses
        if (lines.length >= 2) break;
      }
    })(),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("MCP timeout")), 5000)),
  ]);

  reader.cancel();
  proc.kill();

  const responses = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const initResp = responses.find((r: any) => r.id === 1);
  const listResp = responses.find((r: any) => r.id === 2);

  ok("initialize responds", !!initResp);
  ok("server name is dough-todos", initResp?.result?.serverInfo?.name === "dough-todos");
  ok("tools/list responds", !!listResp);

  const tools: string[] = listResp?.result?.tools?.map((t: any) => t.name) ?? [];
  ok("TodoWrite tool exposed", tools.includes("TodoWrite"));
  ok("TodoRead tool exposed", tools.includes("TodoRead"));
  ok("TodoComplete tool exposed", tools.includes("TodoComplete"));

} catch (e) {
  ok("MCP server smoke test", false, (e as Error).message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup + summary
// ─────────────────────────────────────────────────────────────────────────────
await rm(tmpDir, { recursive: true, force: true });

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
