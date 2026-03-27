// packages/protocol/src/todos.ts

export type TodoStatus = "pending" | "in_progress" | "done" | "verified" | "failed";
export type TodoPriority = "low" | "medium" | "high";

/**
 * Discriminated union of all supported verification strategies.
 * Each strategy defines how the agent proves a todo is complete.
 */
export type TodoVerification =
  | { strategy: "manual"; instructions?: string }
  | { strategy: "command"; command: string; cwd?: string; outputPattern?: string }
  | { strategy: "file_exists"; path: string }
  | { strategy: "file_contains"; path: string; pattern: string; isRegex?: boolean }
  | { strategy: "test_pass"; filter?: string; cwd?: string }
  | { strategy: "llm_judge"; prompt: string };

export interface TodoItem {
  id: string;
  sessionId: string;
  title: string;
  description?: string;
  status: TodoStatus;
  verification: TodoVerification;
  priority?: TodoPriority;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  verifiedAt?: string;
  /** Human-readable details about the last verification attempt */
  verificationDetails?: string;
}

// ── Tool argument shapes ──────────────────────────────────────────────────────

export interface TodoWriteArgs {
  /** Omit to create; supply to update an existing todo */
  id?: string;
  title: string;
  description?: string;
  status?: TodoStatus;
  verification: TodoVerification;
  priority?: TodoPriority;
  tags?: string[];
}

export interface TodoReadArgs {
  /** Filter by one or more statuses. Omit for all. */
  status?: TodoStatus[];
}

export interface TodoCompleteArgs {
  id: string;
}
