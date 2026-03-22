import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import type { Thread, ThreadMessage, ThreadStore } from "../types.ts";

export interface HybridThreadStoreOptions {
  /** Path to the SQLite database file. e.g. ~/.dough/dough.db */
  dbPath: string;
  /** Directory for JSONL message blob files. e.g. ~/.dough/threads */
  threadsDir: string;
}

/** Persisted session record — enough to reconstruct a DoughSession after restart. */
export interface SessionRecord {
  id: string;
  activeThreadId: string;
  provider: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hybrid thread store: SQLite for metadata + JSONL files for message blobs.
 *
 * Layout:
 *   <dbPath>          — SQLite: thread metadata (no messages column)
 *   <threadsDir>/<id>.jsonl — one message per line, append-friendly
 *
 * Benefits:
 *   - list() / load() metadata queries are fast (indexed SQLite)
 *   - Message blobs stay human-readable and are never deleted (per project rules)
 *   - SQLite holds origin, status, tokenCount, summary — all queryable
 */
export class HybridThreadStore implements ThreadStore {
  private db: Database;
  private threadsDir: string;

  constructor(options: HybridThreadStoreOptions) {
    this.threadsDir = options.threadsDir;
    this.db = new Database(options.dbPath);
    this.migrate();
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS threads (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        parent_thread_id TEXT,
        origin           TEXT NOT NULL DEFAULT 'root',
        status           TEXT NOT NULL DEFAULT 'active',
        token_count      INTEGER NOT NULL DEFAULT 0,
        max_tokens       INTEGER NOT NULL DEFAULT 200000,
        summary          TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_threads_session_id ON threads(session_id)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at)`
    );

    // Sessions table — persists session metadata across server restarts
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id               TEXT PRIMARY KEY,
        active_thread_id TEXT NOT NULL,
        provider         TEXT NOT NULL DEFAULT 'claude',
        model            TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      )
    `);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private blobPath(threadId: string): string {
    return `${this.threadsDir}/${threadId}.jsonl`;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.threadsDir, { recursive: true });
  }

  /** Read all messages from a JSONL blob file. Returns [] if file doesn't exist. */
  private async readBlob(threadId: string): Promise<ThreadMessage[]> {
    const file = Bun.file(this.blobPath(threadId));
    if (!(await file.exists())) return [];
    const text = await file.text();
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ThreadMessage);
  }

  /** Overwrite the JSONL blob for a thread (full rewrite on every save). */
  private async writeBlob(thread: Thread): Promise<void> {
    await this.ensureDir();
    const lines = thread.messages.map((m) => JSON.stringify(m)).join("\n");
    await Bun.write(this.blobPath(thread.id), lines ? lines + "\n" : "");
  }

  private rowToPartialThread(row: Record<string, unknown>): Omit<Thread, "messages"> {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      parentThreadId: (row.parent_thread_id as string | null) ?? undefined,
      origin: (row.origin as Thread["origin"]) ?? "root",
      status: row.status as Thread["status"],
      tokenCount: row.token_count as number,
      maxTokens: row.max_tokens as number,
      summary: (row.summary as string | null) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  // ---------------------------------------------------------------------------
  // ThreadStore interface
  // ---------------------------------------------------------------------------

  async save(thread: Thread): Promise<void> {
    // 1. Upsert metadata row in SQLite
    this.db.run(
      `INSERT OR REPLACE INTO threads
         (id, session_id, parent_thread_id, origin, status, token_count,
          max_tokens, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        thread.id,
        thread.sessionId,
        thread.parentThreadId ?? null,
        thread.origin,
        thread.status,
        thread.tokenCount,
        thread.maxTokens,
        thread.summary ?? null,
        thread.createdAt,
        thread.updatedAt,
      ]
    );

    // 2. Write message blob to JSONL
    await this.writeBlob(thread);
  }

  async load(threadId: string): Promise<Thread | null> {
    const row = this.db
      .query("SELECT * FROM threads WHERE id = ?")
      .get(threadId) as Record<string, unknown> | null;

    if (!row) return null;

    const meta = this.rowToPartialThread(row);
    const messages = await this.readBlob(threadId);
    return { ...meta, messages };
  }

  /**
   * List all threads for a session, ordered by creation time (oldest first).
   * Metadata comes from SQLite (fast). Messages loaded from JSONL blobs.
   */
  async list(sessionId: string): Promise<Thread[]> {
    const rows = this.db
      .query(
        "SELECT * FROM threads WHERE session_id = ? ORDER BY created_at ASC"
      )
      .all(sessionId) as Record<string, unknown>[];

    return Promise.all(
      rows.map(async (row) => {
        const meta = this.rowToPartialThread(row);
        const messages = await this.readBlob(meta.id);
        return { ...meta, messages };
      })
    );
  }

  /**
   * Count lines in a JSONL blob without parsing JSON.
   * Fast O(N) string scan — no deserialization overhead.
   */
  private async countBlob(threadId: string): Promise<number> {
    const file = Bun.file(this.blobPath(threadId));
    if (!(await file.exists())) return 0;
    const text = await file.text();
    return text.trim() ? text.trim().split("\n").filter(Boolean).length : 0;
  }

  /**
   * List metadata for all threads across ALL sessions, newest first.
   * Includes a real messageCount derived from the JSONL line count
   * (avoids loading and parsing every message blob).
   * Used by the server for global session/thread sync.
   */
  async listAll(): Promise<Array<Omit<Thread, "messages"> & { messageCount: number }>> {
    const rows = this.db
      .query("SELECT * FROM threads ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[];
    return Promise.all(
      rows.map(async (row) => {
        const meta = this.rowToPartialThread(row);
        const messageCount = await this.countBlob(meta.id);
        return { ...meta, messageCount };
      })
    );
  }

  async delete(threadId: string): Promise<void> {
    this.db.run("DELETE FROM threads WHERE id = ?", [threadId]);
    // Note: per project rules, JSONL files are never deleted — leave the blob.
  }

  // ---------------------------------------------------------------------------
  // Session persistence
  // ---------------------------------------------------------------------------

  /** Upsert a session record (called on create and whenever activeThreadId changes). */
  saveSession(record: SessionRecord): void {
    this.db.run(
      `INSERT OR REPLACE INTO sessions
         (id, active_thread_id, provider, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.activeThreadId,
        record.provider,
        record.model ?? null,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  /** Load a session record by id. Returns null if not found. */
  loadSession(sessionId: string): SessionRecord | null {
    const row = this.db
      .query("SELECT * FROM sessions WHERE id = ?")
      .get(sessionId) as Record<string, unknown> | null;
    if (!row) return null;
    return {
      id: row.id as string,
      activeThreadId: row.active_thread_id as string,
      provider: row.provider as string,
      model: (row.model as string | null) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /** List all session records, newest first. */
  listSessions(): SessionRecord[] {
    const rows = this.db
      .query("SELECT * FROM sessions ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: row.id as string,
      activeThreadId: row.active_thread_id as string,
      provider: row.provider as string,
      model: (row.model as string | null) ?? undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}
