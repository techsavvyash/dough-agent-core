import type { Thread, ThreadStore, SessionRecord, ThreadSummary } from "../types.ts";

/**
 * In-memory thread store. Simple default for development and testing.
 * Threads are lost when the process exits.
 */
export class MemoryThreadStore implements ThreadStore {
  private threads = new Map<string, Thread>();
  private sessions = new Map<string, SessionRecord>();

  async save(thread: Thread): Promise<void> {
    this.threads.set(thread.id, structuredClone(thread));
  }

  async load(threadId: string): Promise<Thread | null> {
    const thread = this.threads.get(threadId);
    return thread ? structuredClone(thread) : null;
  }

  async list(sessionId: string): Promise<Thread[]> {
    const result: Thread[] = [];
    for (const thread of this.threads.values()) {
      if (thread.sessionId === sessionId) {
        result.push(structuredClone(thread));
      }
    }
    return result.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async delete(threadId: string): Promise<void> {
    this.threads.delete(threadId);
  }

  // ── Session operations ──────────────────────────────────────

  async saveSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.id, structuredClone(record));
  }

  async loadSession(sessionId: string): Promise<SessionRecord | null> {
    const rec = this.sessions.get(sessionId);
    return rec ? structuredClone(rec) : null;
  }

  async listSessions(): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listAll(): Promise<ThreadSummary[]> {
    return [...this.threads.values()]
      .map((t) => {
        const { messages, ...meta } = t;
        return { ...meta, messageCount: messages.length };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
