import type { ToolCallEntry } from "../hooks/useSession.ts";
import { colors, symbols } from "../theme.ts";
import { getDoughSyntaxStyle } from "../utils/syntaxStyle.ts";

interface ToolCallViewProps {
  toolCall: ToolCallEntry;
}

/** Render a single tool call with a left-bordered highlighted box, status icon, and label. */
export function ToolCallView({ toolCall }: ToolCallViewProps) {
  const { name, args, status, result } = toolCall;
  const icon = statusIcon(status);
  const iconColor = statusColor(status);
  const label = formatToolName(name);
  const syntaxStyle = getDoughSyntaxStyle();

  // For Bash/execute: show the full command in a code block instead of inline summary
  const isBash = name === "Bash" || name === "bash" || name === "execute";
  const bashCommand = isBash && args.command ? String(args.command) : null;

  // For non-Bash tools: compact inline arg summary
  const argSummary = bashCommand ? null : formatArgs(name, args);

  return (
    <box
      flexDirection="column"
      marginLeft={3}
      paddingLeft={1}
      border={["left"]}
      borderStyle="single"
      borderColor={iconColor}
    >
      {/* Header row: icon + tool name + optional inline arg */}
      <box height={1} flexDirection="row">
        <text fg={iconColor}>{icon} </text>
        <text fg={colors.textDim}>{label}</text>
        {argSummary ? <text fg={colors.textMuted}> {argSummary}</text> : null}
      </box>

      {/* Bash command: syntax-highlighted code block */}
      {bashCommand && (
        <box paddingLeft={2} paddingTop={0}>
          <markdown
            content={"```bash\n" + bashCommand + "\n```"}
            syntaxStyle={syntaxStyle}
            fg={colors.textDim}
            conceal={true}
            concealCode={false}
            streaming={false}
          />
        </box>
      )}

      {/* Error output */}
      {status === "error" && result != null && (
        <box paddingLeft={1}>
          <text fg={colors.error} wrapMode="word">{String(result).slice(0, 300)}</text>
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

/** Format tool args into a compact one-line summary (used for non-Bash tools) */
function formatArgs(name: string, args: Record<string, unknown>): string {
  // File operations — show last two path segments for context
  if (args.file_path || args.path || args.filePath) {
    const p = String(args.file_path ?? args.path ?? args.filePath);
    const parts = p.split("/").filter(Boolean);
    const short = parts.slice(-2).join("/");
    return short || p;
  }

  // Search — show pattern
  if (args.pattern || args.query) {
    const pat = String(args.pattern ?? args.query);
    return pat.length > 80 ? pat.slice(0, 77) + "…" : pat;
  }

  return "";
}
