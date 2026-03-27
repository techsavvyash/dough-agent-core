import type { TodoItem, TodoStatus } from "@dough/protocol";
import type { TodoStore } from "../store.ts";

export class MemoryTodoStore implements TodoStore {
  private items = new Map<string, TodoItem>();

  async save(item: TodoItem): Promise<void> {
    this.items.set(item.id, { ...item });
  }

  async load(todoId: string): Promise<TodoItem | null> {
    return this.items.get(todoId) ?? null;
  }

  async list(sessionId: string, statusFilter?: TodoStatus[]): Promise<TodoItem[]> {
    const all = Array.from(this.items.values()).filter(
      (item) => item.sessionId === sessionId
    );
    if (!statusFilter || statusFilter.length === 0) return all;
    return all.filter((item) => statusFilter.includes(item.status));
  }

  async delete(todoId: string): Promise<void> {
    this.items.delete(todoId);
  }
}
