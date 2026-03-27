import type { TodoItem, TodoWriteArgs, TodoReadArgs, TodoCompleteArgs } from "@dough/protocol";
import type { TodoStore } from "./store.ts";
import type { TodoVerifier, VerificationResult } from "./verifier.ts";

export interface CompleteResult {
  item: TodoItem;
  verificationResult: VerificationResult | null;
  awaitingManualApproval: boolean;
}

export class TodoManager {
  private changeListeners = new Set<(todos: TodoItem[], sessionId: string) => void>();

  constructor(
    private store: TodoStore,
    private verifier: TodoVerifier
  ) {}

  async write(args: TodoWriteArgs, sessionId: string): Promise<TodoItem> {
    const now = new Date().toISOString();

    let item: TodoItem;
    if (args.id) {
      const existing = await this.store.load(args.id);
      if (existing) {
        item = {
          ...existing,
          title: args.title ?? existing.title,
          description: args.description ?? existing.description,
          status: args.status ?? existing.status,
          verification: args.verification ?? existing.verification,
          priority: args.priority ?? existing.priority,
          tags: args.tags ?? existing.tags,
          updatedAt: now,
        };
      } else {
        // Create with specific ID
        item = {
          id: args.id,
          sessionId,
          title: args.title,
          description: args.description,
          status: args.status ?? "pending",
          verification: args.verification,
          priority: args.priority,
          tags: args.tags,
          createdAt: now,
          updatedAt: now,
        };
      }
    } else {
      item = {
        id: crypto.randomUUID(),
        sessionId,
        title: args.title,
        description: args.description,
        status: args.status ?? "pending",
        verification: args.verification,
        priority: args.priority,
        tags: args.tags,
        createdAt: now,
        updatedAt: now,
      };
    }

    await this.store.save(item);
    await this.notifyChange(sessionId);
    return item;
  }

  async read(args: TodoReadArgs, sessionId: string): Promise<TodoItem[]> {
    return this.store.list(sessionId, args.status);
  }

  async complete(args: TodoCompleteArgs, sessionId: string): Promise<CompleteResult> {
    const item = await this.store.load(args.id);
    if (!item) {
      throw new Error(`Todo not found: ${args.id}`);
    }

    const now = new Date().toISOString();
    const updated: TodoItem = { ...item, status: "done", completedAt: now, updatedAt: now };
    await this.store.save(updated);

    const result = await this.verifier.verify(updated);

    if (result.awaitingManualApproval) {
      // Leave status as "done" — the server will flip to verified/failed after human input
      await this.notifyChange(sessionId);
      return { item: updated, verificationResult: result, awaitingManualApproval: true };
    }

    const finalItem: TodoItem = {
      ...updated,
      status: result.passed ? "verified" : "failed",
      verifiedAt: result.passed ? now : undefined,
      verificationDetails: result.details,
      updatedAt: now,
    };
    await this.store.save(finalItem);
    await this.notifyChange(sessionId);

    return { item: finalItem, verificationResult: result, awaitingManualApproval: false };
  }

  /**
   * Finalize a manual verification after human approval/rejection.
   * Called by ws-handler after the client responds to todo_verification_request.
   */
  async finalizeManualVerification(todoId: string, approved: boolean): Promise<TodoItem> {
    const item = await this.store.load(todoId);
    if (!item) throw new Error(`Todo not found: ${todoId}`);

    const now = new Date().toISOString();
    const finalItem: TodoItem = {
      ...item,
      status: approved ? "verified" : "failed",
      verifiedAt: approved ? now : undefined,
      verificationDetails: approved ? "Manually approved" : "Manually rejected",
      updatedAt: now,
    };
    await this.store.save(finalItem);
    await this.notifyChange(item.sessionId);
    return finalItem;
  }

  /** Subscribe to todo changes for push notifications */
  onChange(listener: (todos: TodoItem[], sessionId: string) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private async notifyChange(sessionId: string): Promise<void> {
    if (this.changeListeners.size === 0) return;
    const todos = await this.store.list(sessionId);
    for (const listener of this.changeListeners) {
      listener(todos, sessionId);
    }
  }
}
