/**
 * Built-in tool definitions for Dough's local tool executor.
 *
 * These match the canonical tool names used by the Claude Agent SDK
 * (Bash, Read, Write, Edit, Glob, Grep) so that all extensions and
 * middleware (git-policy, diff-checkpoint, git-attribution) work
 * identically across providers.
 *
 * Provides both the internal ToolDefinition format and an OpenAI
 * function-calling format converter for the Responses API.
 */

export interface BuiltinToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties?: boolean;
  };
}

/**
 * Returns the JSON Schema definitions for all built-in tools.
 */
export function getBuiltinToolSchemas(): BuiltinToolSchema[] {
  return [
    {
      name: "Bash",
      description:
        "Execute a bash command and return its stdout/stderr. " +
        "Use this for running shell commands, git operations, build tools, etc.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute.",
          },
          timeout: {
            type: "number",
            description:
              "Optional timeout in milliseconds. Defaults to 120000 (2 minutes).",
          },
        },
        required: ["command"],
      },
    },
    {
      name: "Read",
      description:
        "Read the contents of a file. Returns the file content with line numbers.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to read.",
          },
          offset: {
            type: "number",
            description: "Line number to start reading from (1-based).",
          },
          limit: {
            type: "number",
            description: "Maximum number of lines to read.",
          },
        },
        required: ["file_path"],
      },
    },
    {
      name: "Write",
      description:
        "Write content to a file. Creates the file and parent directories if they don't exist. Overwrites existing content.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to write.",
          },
          content: {
            type: "string",
            description: "The content to write to the file.",
          },
        },
        required: ["file_path", "content"],
      },
    },
    {
      name: "Edit",
      description:
        "Edit a file by replacing an exact string match. The old_string must appear exactly once in the file.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to edit.",
          },
          old_string: {
            type: "string",
            description: "The exact string to find and replace. Must be unique in the file.",
          },
          new_string: {
            type: "string",
            description: "The replacement string.",
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
    {
      name: "Glob",
      description:
        "Find files matching a glob pattern. Returns matching file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: 'Glob pattern to match (e.g. "**/*.ts", "src/**/*.tsx").',
          },
          path: {
            type: "string",
            description: "Directory to search in. Defaults to working directory.",
          },
        },
        required: ["pattern"],
      },
    },
    {
      name: "Grep",
      description:
        "Search file contents using a regular expression pattern. Uses ripgrep.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regular expression pattern to search for.",
          },
          path: {
            type: "string",
            description: "File or directory to search in. Defaults to working directory.",
          },
          glob: {
            type: "string",
            description: 'Glob pattern to filter files (e.g. "*.ts").',
          },
        },
        required: ["pattern"],
      },
    },
  ];
}

/**
 * Convert built-in tool schemas to OpenAI function-calling format
 * for the Responses API.
 */
export function toOpenAIFunctions(
  tools: BuiltinToolSchema[]
): Array<{ type: "function"; name: string; description: string; parameters: Record<string, unknown> }> {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}
