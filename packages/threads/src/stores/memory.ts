import type { Thread, ThreadStore } from "../types.ts";

/**
 * In-memory thread store. Simple default for development and testing.
 * Threads are lost when the process exits.
 */
export class MemoryThreadStore implements ThreadStore {
  private threads = new Map<string, Thread>();

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
}
