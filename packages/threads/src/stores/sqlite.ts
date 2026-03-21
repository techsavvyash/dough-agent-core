import { Database } from "bun:sqlite";
import type { Thread, ThreadMessage, ThreadStore } from "../types.ts";

/**
 * SQLite-backed thread store using bun:sqlite.
 * Persists threads across process restarts.
 */
export class SqliteThreadStore implements ThreadStore {
  private db: Database;

  constructor(dbPath: string = "dough-threads.db") {
    this.db = new Database(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_thread_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        token_count INTEGER NOT NULL DEFAULT 0,
        max_tokens INTEGER NOT NULL DEFAULT 200000,
        summary TEXT,
        messages TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_threads_session_id ON threads(session_id)
    `);
  }

  async save(thread: Thread): Promise<void> {
    this.db.run(
      `INSERT OR REPLACE INTO threads (id, session_id, parent_thread_id, status, token_count, max_tokens, summary, messages, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        thread.id,
        thread.sessionId,
        thread.parentThreadId ?? null,
        thread.status,
        thread.tokenCount,
        thread.maxTokens,
        thread.summary ?? null,
        JSON.stringify(thread.messages),
        thread.createdAt,
        thread.updatedAt,
      ]
    );
  }

  async load(threadId: string): Promise<Thread | null> {
    const row = this.db
      .query("SELECT * FROM threads WHERE id = ?")
      .get(threadId) as Record<string, unknown> | null;
    return row ? this.rowToThread(row) : null;
  }

  async list(sessionId: string): Promise<Thread[]> {
    const rows = this.db
      .query("SELECT * FROM threads WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToThread(row));
  }

  async delete(threadId: string): Promise<void> {
    this.db.run("DELETE FROM threads WHERE id = ?", [threadId]);
  }

  private rowToThread(row: Record<string, unknown>): Thread {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      parentThreadId: (row.parent_thread_id as string) ?? undefined,
      status: row.status as Thread["status"],
      tokenCount: row.token_count as number,
      maxTokens: row.max_tokens as number,
      summary: (row.summary as string) ?? undefined,
      messages: JSON.parse(row.messages as string) as ThreadMessage[],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  close(): void {
    this.db.close();
  }
}
