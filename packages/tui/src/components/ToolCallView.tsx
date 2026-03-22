import type { ToolCallEntry } from "../hooks/useSession.ts";
import { colors, symbols } from "../theme.ts";

interface ToolCallViewProps {
  toolCall: ToolCallEntry;
}

/** Render a single tool call with a left-bordered highlighted box, status icon, and label. */
export function ToolCallView({ toolCall }: ToolCallViewProps) {
  const { name, args, status, result } = toolCall;
  const icon = statusIcon(status);
  const iconColor = statusColor(status);
  const label = formatToolName(name);

  // Format key args as a compact summary
  const argSummary = formatArgs(name, args);

  return (
    <box
      flexDirection="column"
      marginLeft={3}
      paddingLeft={1}
      border={["left"]}
      borderStyle="single"
      borderColor={iconColor}
    >
      <box height={1} flexDirection="row">
        <text fg={iconColor}>{icon} </text>
        <text fg={colors.textDim}>{label}</text>
        {argSummary ? <text fg={colors.textMuted}> {argSummary}</text> : null}
      </box>
      {status === "error" && result != null && (
        <box paddingLeft={1} height={1}>
          <text fg={colors.error}>{String(result).slice(0, 120)}</text>
        </box>
      )}
    </box>
  );
}

function statusIcon(status: ToolCallEntry["status"]): string {
  switch (status) {
    case "pending":
      return symbols.toolPending;
    case "success":
      return symbols.toolSuccess;
    case "error":
      return symbols.toolError;
  }
}

function statusColor(status: ToolCallEntry["status"]): string {
  switch (status) {
    case "pending":
      return colors.warning;
    case "success":
      return colors.success;
    case "error":
      return colors.error;
  }
}

/** Make tool names human-readable */
function formatToolName(name: string): string {
  const labels: Record<string, string> = {
    read_file: "Read",
    write_file: "Write",
    create_file: "Create",
    edit_file: "Edit",
    str_replace: "Edit",
    insert: "Insert",
    replace: "Replace",
    patch: "Patch",
    bash: "Run",
    execute: "Run",
    search: "Search",
    grep: "Grep",
    glob: "Glob",
    list_dir: "List",
    delete_file: "Delete",
  };
  return labels[name] ?? name;
}

/** Format tool args into a compact one-line summary */
function formatArgs(name: string, args: Record<string, unknown>): string {
  // File operations — show the path
  if (args.file_path || args.path || args.filePath) {
    const p = String(args.file_path ?? args.path ?? args.filePath);
    const short = p.split("/").pop() ?? p;
    return short;
  }

  // Bash/execute — show the command
  if (args.command) {
    const cmd = String(args.command);
    return cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd;
  }

  // Search — show pattern
  if (args.pattern || args.query) {
    return String(args.pattern ?? args.query);
  }

  return "";
}
