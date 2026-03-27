import type { TodoItem, TodoStatus } from "@dough/protocol";

export interface TodoStore {
  save(item: TodoItem): Promise<void>;
  load(todoId: string): Promise<TodoItem | null>;
  list(sessionId: string, statusFilter?: TodoStatus[]): Promise<TodoItem[]>;
  delete(todoId: string): Promise<void>;
}
