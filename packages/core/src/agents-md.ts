/**
 * AGENTS.md discovery and loading.
 *
 * Walks from the given directory up to the git root, collecting
 * AGENTS.md (and AGENTS.override.md) files. Files closer to cwd
 * take higher precedence. Override files replace the normal file
 * at that directory level.
 *
 * Also supports CLAUDE.md as a fallback per-directory (skipped if
 * AGENTS.md exists at the same level).
 */

const AGENTS_FILE = "AGENTS.md";
const AGENTS_OVERRIDE = "AGENTS.override.md";
const CLAUDE_FILE = "CLAUDE.md";

export interface LoadOptions {
  /**
   * When true, skip CLAUDE.md fallback. Use this when the provider
   * already reads CLAUDE.md on its own (e.g. claude-agent-sdk).
   * Defaults to false.
   */
  skipClaudeMd?: boolean;
}

export interface AgentsMdEntry {
  path: string;
  content: string;
  /** Distance from cwd (0 = cwd itself, 1 = parent, etc.) */
  depth: number;
  isOverride: boolean;
}

export interface AgentsMdResult {
  /** All discovered files, ordered root-first (furthest from cwd first). */
  entries: AgentsMdEntry[];
  /** Merged content: root files first, cwd files last (closest = highest precedence). */
  merged: string;
}

/**
 * Find the git root by walking up from `startDir`.
 * Returns null if not inside a git repo.
 */
export async function findGitRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  while (true) {
    const gitDir = `${dir}/.git`;
    const file = Bun.file(gitDir);
    // .git can be a file (worktree) or directory
    if (await file.exists()) return dir;
    // Also check as directory
    try {
      const stat = await Bun.file(`${gitDir}/HEAD`).exists();
      if (stat) return dir;
    } catch {
      // not a git dir
    }
    const parent = dir.substring(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) return null;
    dir = parent;
  }
}

/**
 * Try to read a file, returning its content or null.
 */
async function tryRead(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      const text = await file.text();
      return text.trim() || null; // skip empty files
    }
  } catch {
    // permission error, etc.
  }
  return null;
}

/**
 * Strip YAML frontmatter (--- ... ---) from the beginning of a file.
 * Some CLAUDE.md files use frontmatter that isn't useful as agent context.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("---", 3);
  if (end === -1) return content;
  return content.substring(end + 3).trim();
}

/**
 * Discover and load all AGENTS.md files from `cwd` up to git root.
 *
 * Priority per directory:
 *  1. AGENTS.override.md (replaces AGENTS.md at that level)
 *  2. AGENTS.md
 *  3. CLAUDE.md (fallback if no AGENTS.md at that level)
 *
 * The merged result concatenates from root → cwd so that closer
 * files appear later and can override earlier guidance.
 */
export async function loadAgentsMd(
  cwd?: string,
  options?: LoadOptions
): Promise<AgentsMdResult> {
  const skipClaudeMd = options?.skipClaudeMd ?? false;
  const startDir = cwd ?? process.cwd();
  const gitRoot = await findGitRoot(startDir);
  const ceiling = gitRoot ?? startDir; // if no git, only check cwd

  // Collect directories from cwd up to ceiling
  const dirs: string[] = [];
  let dir = startDir;
  while (true) {
    dirs.push(dir);
    if (dir === ceiling) break;
    const parent = dir.substring(0, dir.lastIndexOf("/"));
    if (!parent || parent === dir) break;
    dir = parent;
  }

  // Walk root-first (reverse so root is index 0)
  dirs.reverse();

  const entries: AgentsMdEntry[] = [];

  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    const depth = dirs.length - 1 - i; // 0 = root-level

    // Check override first
    const overridePath = `${d}/${AGENTS_OVERRIDE}`;
    const overrideContent = await tryRead(overridePath);
    if (overrideContent) {
      entries.push({
        path: overridePath,
        content: stripFrontmatter(overrideContent),
        depth,
        isOverride: true,
      });
      continue; // override replaces everything at this level
    }

    // Check AGENTS.md
    const agentsPath = `${d}/${AGENTS_FILE}`;
    const agentsContent = await tryRead(agentsPath);
    if (agentsContent) {
      entries.push({
        path: agentsPath,
        content: stripFrontmatter(agentsContent),
        depth,
        isOverride: false,
      });
      continue;
    }

    // Fallback: CLAUDE.md (skipped when provider handles it natively)
    if (!skipClaudeMd) {
      const claudePath = `${d}/${CLAUDE_FILE}`;
      const claudeContent = await tryRead(claudePath);
      if (claudeContent) {
        entries.push({
          path: claudePath,
          content: stripFrontmatter(claudeContent),
          depth,
          isOverride: false,
        });
      }
    }
  }

  // Merge: root first, cwd last
  const merged = entries.map((e) => e.content).join("\n\n---\n\n");

  return { entries, merged };
}

/**
 * Build a system prompt section from discovered AGENTS.md files.
 * Returns an empty string if no files were found.
 */
export async function buildAgentsContext(
  cwd?: string,
  options?: LoadOptions
): Promise<string> {
  const result = await loadAgentsMd(cwd, options);
  if (result.entries.length === 0) return "";

  const header = `# Project Instructions (from ${result.entries.map((e) => e.path).join(", ")})`;
  return `${header}\n\n${result.merged}`;
}
