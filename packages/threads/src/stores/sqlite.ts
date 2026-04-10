import { Database } from "bun:sqlite";
import type { Thread, ThreadMessage, ThreadStore, SessionRecord, ThreadSummary } from "../types.ts";

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
        origin TEXT NOT NULL DEFAULT 'root',
        status TEXT NOT NULL DEFAULT 'active',
        token_count INTEGER NOT NULL DEFAULT 0,
        max_tokens INTEGER NOT NULL DEFAULT 200000,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        messages TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_threads_session_id ON threads(session_id)`
    );
    // Add origin column to existing databases that predate this migration
    try {
      this.db.run(`ALTER TABLE threads ADD COLUMN origin TEXT NOT NULL DEFAULT 'root'`);
    } catch {
      // Column already exists — safe to ignore
    }
    // Add tokens_used column to existing databases
    try {
      this.db.run(`ALTER TABLE threads ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column already exists — safe to ignore
    }

    // Sessions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                  TEXT PRIMARY KEY,
        active_thread_id    TEXT NOT NULL,
        provider            TEXT NOT NULL DEFAULT 'claude',
        model               TEXT,
        provider_session_id TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      )
    `);
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN provider_session_id TEXT`);
    } catch {
      // Column already exists
    }
  }

  async save(thread: Thread): Promise<void> {
    this.db.run(
      `INSERT OR REPLACE INTO threads
         (id, session_id, parent_thread_id, origin, status, token_count,
          max_tokens, tokens_used, summary, messages, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        thread.id,
        thread.sessionId,
        thread.parentThreadId ?? null,
        thread.origin,
        thread.status,
        thread.tokenCount,
        thread.maxTokens,
        thread.tokensUsed,
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
      parentThreadId: (row.parent_thread_id as string | null) ?? undefined,
      origin: (row.origin as Thread["origin"]) ?? "root",
      status: row.status as Thread["status"],
      tokenCount: row.token_count as number,
      maxTokens: row.max_tokens as number,
      tokensUsed: (row.tokens_used as number) ?? 0,
      summary: (row.summary as string | null) ?? undefined,
      messages: JSON.parse(row.messages as string) as ThreadMessage[],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ── Session operations ──────────────────────────────────────

  async saveSession(record: SessionRecord): Promise<void> {
    this.db.run(
      `INSERT OR REPLACE INTO sessions
         (id, active_thread_id, provider, model, provider_session_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.activeThreadId,
        record.provider,
        record.model ?? null,
        record.providerSessionId ?? null,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  async loadSession(sessionId: string): Promise<SessionRecord | null> {
    const row = this.db
      .query("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      id: row.id as string,
      activeThreadId: row.active_thread_id as string,
      provider: row.provider as string,
      model: (row.model as string | null) ?? undefined,
      providerSessionId: (row.provider_session_id as string | null) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  async listSessions(): Promise<SessionRecord[]> {
    const rows = this.db
      .query("SELECT * FROM sessions ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      activeThreadId: row.active_thread_id as string,
      provider: row.provider as string,
      model: (row.model as string | null) ?? undefined,
      providerSessionId: (row.provider_session_id as string | null) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  async listAll(): Promise<ThreadSummary[]> {
    const rows = this.db
      .query("SELECT * FROM threads ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map((row) => {
      const { messages, ...rest } = this.rowToThread(row);
      return { ...rest, messageCount: messages.length };
    });
  }

  close(): void {
    this.db.close();
  }
}
