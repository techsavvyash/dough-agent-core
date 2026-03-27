import { Database } from "bun:sqlite";
import type { TodoItem, TodoStatus, TodoVerification } from "@dough/protocol";
import type { TodoStore } from "../store.ts";

export class SqliteTodoStore implements TodoStore {
  private db: Database;

  constructor(dbPath: string = "dough-todos.db") {
    this.db = new Database(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        verification TEXT NOT NULL,
        priority TEXT,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        verified_at TEXT,
        verification_details TEXT
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_todos_session_id ON todos(session_id)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status)`
    );
  }

  async save(item: TodoItem): Promise<void> {
    this.db.run(
      `INSERT OR REPLACE INTO todos
         (id, session_id, title, description, status, verification, priority,
          tags, created_at, updated_at, completed_at, verified_at, verification_details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.sessionId,
        item.title,
        item.description ?? null,
        item.status,
        JSON.stringify(item.verification),
        item.priority ?? null,
        item.tags ? JSON.stringify(item.tags) : null,
        item.createdAt,
        item.updatedAt,
        item.completedAt ?? null,
        item.verifiedAt ?? null,
        item.verificationDetails ?? null,
      ]
    );
  }

  async load(todoId: string): Promise<TodoItem | null> {
    const row = this.db.query(
      `SELECT * FROM todos WHERE id = ?`
    ).get(todoId) as Record<string, unknown> | null;
    if (!row) return null;
    return this.rowToItem(row);
  }

  async list(sessionId: string, statusFilter?: TodoStatus[]): Promise<TodoItem[]> {
    let rows: Record<string, unknown>[];
    if (!statusFilter || statusFilter.length === 0) {
      rows = this.db.query(
        `SELECT * FROM todos WHERE session_id = ? ORDER BY created_at ASC`
      ).all(sessionId) as Record<string, unknown>[];
    } else {
      const placeholders = statusFilter.map(() => "?").join(", ");
      rows = this.db.query(
        `SELECT * FROM todos WHERE session_id = ? AND status IN (${placeholders}) ORDER BY created_at ASC`
      ).all(sessionId, ...statusFilter) as Record<string, unknown>[];
    }
    return rows.map((r) => this.rowToItem(r));
  }

  async delete(todoId: string): Promise<void> {
    this.db.run(`DELETE FROM todos WHERE id = ?`, [todoId]);
  }

  private rowToItem(row: Record<string, unknown>): TodoItem {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      title: row.title as string,
      description: (row.description as string | null) ?? undefined,
      status: row.status as TodoStatus,
      verification: JSON.parse(row.verification as string) as TodoVerification,
      priority: (row.priority as TodoItem["priority"] | null) ?? undefined,
      tags: row.tags ? (JSON.parse(row.tags as string) as string[]) : undefined,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: (row.completed_at as string | null) ?? undefined,
      verifiedAt: (row.verified_at as string | null) ?? undefined,
      verificationDetails: (row.verification_details as string | null) ?? undefined,
    };
  }
}
