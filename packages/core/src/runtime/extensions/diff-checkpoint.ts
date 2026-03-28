/**
 * diff-checkpoint extension — tracks file changes made by the agent.
 *
 * Intercepts tool:call and tool:result events to snapshot files before
 * writes and record the after-state. Computes unified diffs and exposes
 * stats and full diff payloads.
 *
 * Tracks file changes via tool:call and tool:result runtime events,
 * computing unified diffs and exposing stats/payloads to the server.
 */

import type { ChangeStats, DiffPayload } from "@dough/protocol";
import type { RuntimeExtension } from "../extension.ts";
import type { PlatformAPI } from "../api.ts";
import { FileTracker, type FileTrackerPersistence } from "../file-tracker.ts";

/** Tool names that write to files — we intercept these for diffing */
const FILE_WRITE_TOOLS = new Set([
  // claude-agent-sdk tool names (capitalized)
  "Write", "Edit", "MultiEdit",
  // Common lowercase variants
  "write_file", "create_file", "edit_file", "str_replace",
  "insert", "replace", "write", "patch",
]);

const FILE_DELETE_TOOLS = new Set([
  "delete_file", "remove_file", "rm", "Delete",
]);

/**
 * Extract file path from a tool call's arguments.
 * Handles common patterns: { path }, { file_path }, { filePath }
 */
function extractFilePath(args: Record<string, unknown>): string | null {
  for (const key of ["path", "file_path", "filePath", "file", "filename"]) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return null;
}

export interface DiffCheckpointExtensionInstance extends RuntimeExtension {
  /** Get the underlying FileTracker for direct access (e.g. hydrate, reset). */
  getTracker(): FileTracker;
  /** Get aggregated change stats. */
  getStats(): ChangeStats;
  /** Get full diff payload. */
  getDiffs(sessionId: string, threadId?: string): DiffPayload;
}

export function createDiffCheckpointExtension(
  persistence?: FileTrackerPersistence,
): DiffCheckpointExtensionInstance {
  const tracker = new FileTracker({ persistence });

  return {
    id: "diff-checkpoint",
    name: "Diff Checkpoint",
    kind: "both",

    getTracker() {
      return tracker;
    },

    getStats() {
      return tracker.getStats();
    },

    getDiffs(sessionId: string, threadId?: string) {
      return tracker.getDiffs(sessionId, threadId);
    },

    setup(api: PlatformAPI) {
      // ── Snapshot before file writes ──
      api.on("tool:call", async (event) => {
        if (FILE_WRITE_TOOLS.has(event.toolName)) {
          const filePath = extractFilePath(event.args);
          if (filePath) await tracker.snapshotBefore(filePath);
        }

        if (FILE_DELETE_TOOLS.has(event.toolName)) {
          const filePath = extractFilePath(event.args);
          if (filePath) await tracker.recordDelete(filePath);
        }
      });

      // ── Record after file writes ──
      api.on("tool:result", async (event) => {
        if (event.isError) return;
        // Record after-state for any pending snapshots
        for (const filePath of (tracker as any).snapshots.keys()) {
          await tracker.recordAfter(filePath);
        }
      });

      // ── Reset tracker on new session ──
      api.on("session:start", () => {
        tracker.reset();
        if (api.sessionId) tracker.setSessionId(api.sessionId);
      });

      // ── Hydrate on resume ──
      api.on("session:resume", () => {
        if (api.sessionId) {
          tracker.setSessionId(api.sessionId);
          tracker.hydrate(api.sessionId);
        }
      });

      // ── Register diff command and shortcut ──
      api.registerCommand({
        id: "diff.show",
        name: "/diff",
        description: "Show file changes (Ctrl+D)",
        category: "diff",
        execute() {
          api.openPanel("diff.panel");
        },
      });

      api.registerShortcut({
        id: "diff.shortcut",
        key: "ctrl+d",
        description: "Open diff view",
        commandId: "diff.show",
      });

      api.registerPanel({
        id: "diff.panel",
        name: "File Changes",
        mode: "overlay",
      });
    },
  };
}
