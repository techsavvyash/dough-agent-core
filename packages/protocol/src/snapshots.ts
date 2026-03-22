/**
 * Types for the copy-on-write file diff tracking system.
 *
 * The server snapshots file contents before the agent overwrites them,
 * computes diffs, and streams change stats to the TUI in real-time.
 */

/** Summary stats for a single file change */
export interface FileChangeStat {
  filePath: string;
  linesAdded: number;
  linesRemoved: number;
  /** "added" = new file, "modified" = changed, "deleted" = removed */
  status: "added" | "modified" | "deleted";
}

/** Aggregated change stats for the entire session */
export interface ChangeStats {
  filesChanged: number;
  totalAdded: number;
  totalRemoved: number;
  files: FileChangeStat[];
}

/** A single file's diff data for rendering in the TUI */
export interface FileDiff {
  filePath: string;
  status: "added" | "modified" | "deleted";
  /** Unified diff string (compatible with OpenTUI <diff> component) */
  unifiedDiff: string;
  linesAdded: number;
  linesRemoved: number;
  /** Language for syntax highlighting (derived from file extension) */
  language?: string;
  /**
   * Full original file content — populated by the server so the TUI can render
   * the entire file in side-by-side split view (not just the changed hunks).
   * Empty string = file did not exist before (new file).
   */
  beforeText?: string;
  /**
   * Full modified file content — populated by the server for split-view rendering.
   * Empty string = file was deleted.
   */
  afterText?: string;
}

/** Full diff payload sent when the user enters diff mode */
export interface DiffPayload {
  sessionId: string;
  threadId?: string;
  stats: ChangeStats;
  diffs: FileDiff[];
}
