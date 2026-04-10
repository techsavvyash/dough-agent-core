import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import type { Thread, ThreadMessage, ThreadStore, SessionRecord, ThreadSummary, FileDiffRecord } from "../types.ts";

export interface HybridThreadStoreOptions {
  /** Path to the SQLite database file. e.g. ~/.dough/dough.db */
  dbPath: string;
  /** Directory for JSONL message blob files. e.g. ~/.dough/threads */
  threadsDir: string;
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
        tokens_used      INTEGER NOT NULL DEFAULT 0,
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
        id                  TEXT PRIMARY KEY,
        active_thread_id    TEXT NOT NULL,
        provider            TEXT NOT NULL DEFAULT 'claude',
        model               TEXT,
        provider_session_id TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      )
    `);
    // Additive migration: add provider_session_id to existing DBs
    try {
      this.db.run(`ALTER TABLE sessions ADD COLUMN provider_session_id TEXT`);
    } catch {
      // Column already exists — safe to ignore
    }
    // Additive migration: add tokens_used to existing DBs
    try {
      this.db.run(`ALTER TABLE threads ADD COLUMN tokens_used INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column already exists — safe to ignore
    }

    // File diff persistence — keyed by (session_id, file_path) so each session
    // has its own independent set of tracked changes.
    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_diffs (
        session_id    TEXT NOT NULL,
        file_path     TEXT NOT NULL,
        status        TEXT NOT NULL,
        before_text   TEXT,
        after_text    TEXT,
        unified_diff  TEXT NOT NULL DEFAULT '',
        lines_added   INTEGER NOT NULL DEFAULT 0,
        lines_removed INTEGER NOT NULL DEFAULT 0,
        language      TEXT,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (session_id, file_path)
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_file_diffs_session_id ON file_diffs(session_id)`
    );
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
      tokensUsed: (row.tokens_used as number) ?? 0,
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
          max_tokens, tokens_used, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  async listAll(): Promise<ThreadSummary[]> {
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

  /** Load a session record by id. Returns null if not found. */
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

  /** List all session records, newest first. */
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

  // ---------------------------------------------------------------------------
  // File diff persistence (not part of ThreadStore interface — server-only)
  // ---------------------------------------------------------------------------

  /** Upsert a single file diff row for a session. Idempotent: last write wins. */
  saveFileDiff(record: FileDiffRecord): void {
    console.log(`[hybrid-store] saveFileDiff(session=${record.sessionId}, path=${record.filePath}, status=${record.status})`);
    this.db.run(
      `INSERT OR REPLACE INTO file_diffs
         (session_id, file_path, status, before_text, after_text,
          unified_diff, lines_added, lines_removed, language, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.sessionId,
        record.filePath,
        record.status,
        record.beforeText ?? null,
        record.afterText ?? null,
        record.unifiedDiff,
        record.linesAdded,
        record.linesRemoved,
        record.language ?? null,
        record.updatedAt,
      ]
    );
  }

  /** Load all file diff records for a session, oldest change first. Returns [] if none. */
  loadFileDiffs(sessionId: string): FileDiffRecord[] {
    console.log(`[hybrid-store] loadFileDiffs(session=${sessionId})`);
    const rows = this.db
      .query(
        "SELECT * FROM file_diffs WHERE session_id = ? ORDER BY updated_at ASC"
      )
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((row) => ({
      sessionId: row.session_id as string,
      filePath: row.file_path as string,
      status: row.status as FileDiffRecord["status"],
      beforeText: (row.before_text as string | null) ?? null,
      afterText: (row.after_text as string | null) ?? null,
      unifiedDiff: row.unified_diff as string,
      linesAdded: row.lines_added as number,
      linesRemoved: row.lines_removed as number,
      language: (row.language as string | null) ?? undefined,
      updatedAt: row.updated_at as string,
    }));
  }

  /** Delete all file diff records for a session (e.g. on new session / explicit reset). */
  clearFileDiffs(sessionId: string): void {
    this.db.run("DELETE FROM file_diffs WHERE session_id = ?", [sessionId]);
  }

  close(): void {
    this.db.close();
  }
}
