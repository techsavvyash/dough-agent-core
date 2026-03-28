/**
 * Registration types for runtime contributions:
 * commands, shortcuts, panels, and tools.
 */

import type { PlatformRuntime } from "./runtime.ts";

export interface CommandContext {
  sessionId: string;
  activeThreadId: string;
  runtime: PlatformRuntime;
}

export interface RuntimeCommand {
  id: string;
  /** Display name, e.g. "/thread info" */
  name: string;
  description: string;
  /** For palette grouping */
  category?: string;
  execute: (ctx: CommandContext) => void | Promise<void>;
}

export interface RuntimeShortcut {
  id: string;
  /** Key binding, e.g. "ctrl+d" */
  key: string;
  description: string;
  /** References a RuntimeCommand.id */
  commandId: string;
}

export interface RuntimePanel {
  id: string;
  name: string;
  /** "overlay" = full-screen like DiffView, "inline" = within chat area */
  mode: "overlay" | "inline";
}

export interface RuntimeTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
