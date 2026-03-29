import { colors } from "../theme.ts";
import type { ToolCallEntry } from "../hooks/useSession.ts";
import { ToolCallView } from "./ToolCallView.tsx";

interface ToolCallGroupProps {
  toolCalls: ToolCallEntry[];
}

/**
 * Renders all tool calls for a single assistant turn inside one bordered
 * container, separated by horizontal rules.
 *
 *   ┌─ 3 tools ────────────────────────────────┐
 *   │ ✓  $  git status                         │
 *   │    main                                  │
 *   │──────────────────────────────────────────│
 *   │ ✓  Read   src/App.tsx                    │
 *   │──────────────────────────────────────────│
 *   │ ⠙  Write  src/App.tsx                    │
 *   └──────────────────────────────────────────┘
 */
export function ToolCallGroup({ toolCalls }: ToolCallGroupProps) {
  if (toolCalls.length === 0) return null;

  const pendingCount = toolCalls.filter((tc) => tc.status === "pending").length;
  const errorCount = toolCalls.filter((tc) => tc.status === "error").length;

  const headerColor =
    pendingCount > 0
      ? colors.warning
      : errorCount > 0
        ? colors.error
        : colors.textMuted;

  const headerLabel =
    pendingCount > 0
      ? `${String(pendingCount)} running · ${String(toolCalls.length)} total`
      : errorCount > 0
        ? `${String(toolCalls.length)} tool${toolCalls.length > 1 ? "s" : ""}  ·  ${String(errorCount)} error${errorCount > 1 ? "s" : ""}`
        : `${String(toolCalls.length)} tool${toolCalls.length > 1 ? "s" : ""}`;

  return (
    <box
      flexDirection="column"
      marginLeft={1}
      marginTop={1}
      marginBottom={1}
      border={["top", "bottom", "left", "right"]}
      borderStyle="single"
      borderColor={colors.border}
    >
      {/* Header row ─ tool count / status */}
      <box height={1} paddingX={1}>
        <text fg={headerColor}>{headerLabel}</text>
      </box>

      {/* Header separator */}
      <box height={1}>
        <text fg={colors.border}>{"─".repeat(500)}</text>
      </box>

      {/* Tool call rows, separated by horizontal rules */}
      {toolCalls.map((tc, i) => (
        <box key={tc.callId} flexDirection="column">
          {i > 0 && (
            <box height={1}>
              <text fg={colors.border}>{"─".repeat(500)}</text>
            </box>
          )}
          <ToolCallView toolCall={tc} />
        </box>
      ))}
    </box>
  );
}
