import type {
  ChangeStats,
  FileChangeStat,
  FileDiff,
  DiffPayload,
} from "@dough/protocol";
import { createPatch } from "diff";

/**
 * Copy-on-write file change tracker.
 *
 * Before the agent writes to a file, call `snapshotBefore(path)` to
 * capture its current content. After the write, call `recordAfter(path)`
 * to capture the new content. The tracker computes diffs lazily and
 * streams aggregated stats via the `onChange` callback.
 */
export class FileTracker {
  /** Original file contents keyed by absolute path */
  private snapshots = new Map<string, string | null>();
  /** Current file contents after agent writes */
  private current = new Map<string, string | null>();
  /** Cached per-file stats */
  private statsCache = new Map<string, FileChangeStat>();
  /** Listener for change stats updates */
  private onChangeListeners = new Set<(stats: ChangeStats) => void>();

  /**
   * Snapshot the file's content before the agent writes to it.
   * Only snapshots once per path — the first "before" is what matters.
   */
  async snapshotBefore(filePath: string): Promise<void> {
    if (this.snapshots.has(filePath)) return; // already captured
    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        this.snapshots.set(filePath, await file.text());
      } else {
        this.snapshots.set(filePath, null); // new file
      }
    } catch {
      this.snapshots.set(filePath, null); // treat read errors as new file
    }
  }

  /**
   * Record the file's content after the agent has written to it.
   * Recomputes stats for this file and notifies listeners.
   */
  async recordAfter(filePath: string): Promise<void> {
    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        this.current.set(filePath, await file.text());
      } else {
        this.current.set(filePath, null); // file was deleted
      }
    } catch {
      this.current.set(filePath, null);
    }

    // Recompute stats for this file
    this.updateFileStat(filePath);
    this.notifyListeners();
  }

  /**
   * Record a file deletion by the agent.
   */
  async recordDelete(filePath: string): Promise<void> {
    await this.snapshotBefore(filePath);
    this.current.set(filePath, null);
    this.updateFileStat(filePath);
    this.notifyListeners();
  }

  private updateFileStat(filePath: string): void {
    const before = this.snapshots.get(filePath) ?? null;
    const after = this.current.get(filePath) ?? null;

    if (before === after) {
      this.statsCache.delete(filePath);
      return;
    }

    let status: FileChangeStat["status"];
    if (before === null) status = "added";
    else if (after === null) status = "deleted";
    else status = "modified";

    const beforeLines = before?.split("\n") ?? [];
    const afterLines = after?.split("\n") ?? [];

    // Simple line diff count
    const patch = createPatch(filePath, before ?? "", after ?? "", "", "");
    let added = 0;
    let removed = 0;
    for (const line of patch.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }

    this.statsCache.set(filePath, {
      filePath,
      linesAdded: added,
      linesRemoved: removed,
      status,
    });
  }

  /** Get aggregated change stats */
  getStats(): ChangeStats {
    const files = Array.from(this.statsCache.values());
    return {
      filesChanged: files.length,
      totalAdded: files.reduce((s, f) => s + f.linesAdded, 0),
      totalRemoved: files.reduce((s, f) => s + f.linesRemoved, 0),
      files,
    };
  }

  /** Get full diffs for all tracked files */
  getDiffs(sessionId: string, threadId?: string): DiffPayload {
    const diffs: FileDiff[] = [];

    for (const [filePath, stat] of this.statsCache) {
      const before = this.snapshots.get(filePath) ?? "";
      const after = this.current.get(filePath) ?? "";
      const unifiedDiff = createPatch(filePath, before, after, "original", "modified");

      diffs.push({
        filePath,
        status: stat.status,
        unifiedDiff,
        linesAdded: stat.linesAdded,
        linesRemoved: stat.linesRemoved,
        language: extToLanguage(filePath),
      });
    }

    // Sort: modified first, then added, then deleted
    const order = { modified: 0, added: 1, deleted: 2 };
    diffs.sort((a, b) => order[a.status] - order[b.status]);

    return {
      sessionId,
      threadId,
      stats: this.getStats(),
      diffs,
    };
  }

  /** Subscribe to stats changes */
  onChange(listener: (stats: ChangeStats) => void): () => void {
    this.onChangeListeners.add(listener);
    return () => this.onChangeListeners.delete(listener);
  }

  private notifyListeners(): void {
    const stats = this.getStats();
    for (const listener of this.onChangeListeners) {
      listener(stats);
    }
  }

  /** Reset all tracking (e.g., on new session) */
  reset(): void {
    this.snapshots.clear();
    this.current.clear();
    this.statsCache.clear();
  }

  /** Number of tracked files */
  get trackedCount(): number {
    return this.statsCache.size;
  }
}

/** Map file extension to language name for syntax highlighting */
function extToLanguage(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    css: "css",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    toml: "toml",
    xml: "xml",
    vue: "vue",
    svelte: "svelte",
  };
  return ext ? map[ext] : undefined;
}
