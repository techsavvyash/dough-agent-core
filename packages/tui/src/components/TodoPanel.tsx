import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { TodoItem, TodoStatus } from "@dough/protocol";
import { colors, symbols, hrule } from "../theme.ts";
import type { VerificationRequest } from "../hooks/useTodos.ts";

interface TodoPanelProps {
  todos: TodoItem[];
  verificationRequest: VerificationRequest | null;
  onClose: () => void;
  onApprove: (todoId: string, approved: boolean) => void;
}

const STATUS_BADGE: Record<TodoStatus, { label: string; color: string }> = {
  pending:     { label: "pending",     color: colors.textDim },
  in_progress: { label: "in_progress", color: colors.warning },
  done:        { label: "done",        color: colors.accent },
  verified:    { label: "verified",    color: colors.success },
  failed:      { label: "failed",      color: colors.error },
};

const PRIORITY_BADGE: Record<string, string> = {
  high:   "!",
  medium: "~",
  low:    "·",
};

function statusLabel(status: TodoStatus): string {
  return STATUS_BADGE[status]?.label ?? status;
}

function statusColor(status: TodoStatus): string {
  return STATUS_BADGE[status]?.color ?? colors.text;
}

/**
 * Full-screen todo panel overlay.
 * Shows the list of todos with status badges.
 * When a verification request is pending, shows an approval overlay.
 * Keyboard: ↑↓ navigate, Esc close.
 */
export function TodoPanel({
  todos,
  verificationRequest,
  onClose,
  onApprove,
}: TodoPanelProps) {
  const { width } = useTerminalDimensions();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeyboard((key) => {
    // When a verification request is showing, y/n approve/reject it
    if (verificationRequest) {
      if (key.name === "y" || key.sequence === "y") {
        onApprove(verificationRequest.todoId, true);
      } else if (key.name === "n" || key.sequence === "n") {
        onApprove(verificationRequest.todoId, false);
      } else if (key.name === "escape") {
        onApprove(verificationRequest.todoId, false);
      }
      return;
    }

    if (key.name === "escape") {
      onClose();
    } else if (key.name === "up") {
      setSelectedIndex((i: number) => Math.max(0, i - 1));
    } else if (key.name === "down") {
      setSelectedIndex((i: number) => Math.min(Math.max(0, todos.length - 1), i + 1));
    }
  });

  const rule = hrule(width);
  const panelHeight = Math.max(todos.length + 5, 7);

  // ── Verification request overlay ─────────────────────────────────────────

  if (verificationRequest) {
    const overlayHeight = 7;
    return (
      <box flexDirection="column" height={overlayHeight}>
        <box height={1}>
          <text fg={colors.borderActive}>{rule}</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.warning}>{"  Verification Request"}</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.text}>{`  Task: ${verificationRequest.title}`}</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.textDim}>{`  ${verificationRequest.instructions}`}</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={colors.accent}>{"  Approve? [y]es / [n]o"}</text>
        </box>
        <box height={1} paddingX={1}>
          <text fg={colors.textMuted}>{"  y approve  ·  n reject  ·  Esc reject"}</text>
        </box>
        <box height={1}>
          <text fg={colors.borderActive}>{rule}</text>
        </box>
      </box>
    );
  }

  // ── Todo list ─────────────────────────────────────────────────────────────

  return (
    <box flexDirection="column" height={panelHeight}>
      <box height={1}>
        <text fg={colors.borderActive}>{rule}</text>
      </box>

      {/* Header */}
      <box height={1} paddingX={1}>
        <text fg={colors.primary}>{`  ${symbols.info} Todos  (${todos.length} item${todos.length !== 1 ? "s" : ""})`}</text>
      </box>

      <box height={1}>
        <text fg={colors.border}>{rule}</text>
      </box>

      {/* Todo items */}
      <box flexDirection="column">
        {todos.length === 0 ? (
          <box height={1} paddingX={2}>
            <text fg={colors.textMuted}>{"  No todos yet."}</text>
          </box>
        ) : (
          todos.map((todo, idx) => {
            const isSelected = idx === selectedIndex;
            const indicator = isSelected ? `${symbols.userPrefix} ` : "  ";
            const badge = `[${statusLabel(todo.status)}]`;
            const prio = todo.priority ? ` ${PRIORITY_BADGE[todo.priority] ?? ""}` : "";
            const tags = todo.tags && todo.tags.length > 0 ? `  #${todo.tags.join(" #")}` : "";
            const line = `${indicator}${badge}${prio}  ${todo.title}${tags}`;
            return (
              <box key={todo.id} height={1}>
                <text fg={isSelected ? colors.primary : statusColor(todo.status)}>
                  {line}
                </text>
              </box>
            );
          })
        )}
      </box>

      {/* Footer hint */}
      <box height={1} paddingX={1}>
        <text fg={colors.textMuted}>{"  ↑↓ navigate  ·  Esc close"}</text>
      </box>

      <box height={1}>
        <text fg={colors.borderActive}>{rule}</text>
      </box>
    </box>
  );
}
