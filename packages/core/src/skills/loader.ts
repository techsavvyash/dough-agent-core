/**
 * Skill discovery and loading.
 *
 * Scans well-known directories for folders containing SKILL.md files,
 * parses YAML frontmatter, and returns structured skill metadata.
 *
 * Search paths (in order):
 *  1. Project-level: <cwd>/.agents/skills/
 *  2. Project-level (client-specific): <cwd>/.dough/skills/
 *  3. User-level: ~/.agents/skills/
 *  4. User-level (client-specific): ~/.dough/skills/
 *
 * Project-level skills override user-level skills with the same name.
 */

import type { SkillMeta, Skill } from "@dough/protocol";
import { homedir } from "node:os";
import { resolve, basename } from "node:path";

const SKILL_FILE = "SKILL.md";

/** Directories to scan, in priority order (first = highest priority) */
function getSearchPaths(cwd: string): string[] {
  const home = homedir();
  return [
    resolve(cwd, ".agents/skills"),
    resolve(cwd, ".dough/skills"),
    resolve(home, ".agents/skills"),
    resolve(home, ".dough/skills"),
  ];
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns { frontmatter, body } or null if no valid frontmatter.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} | null {
  if (!content.startsWith("---")) return null;
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return null;

  const yamlBlock = content.substring(4, endIdx).trim();
  const body = content.substring(endIdx + 4).trim();

  // Simple YAML parser for flat key-value pairs (no external deps)
  const frontmatter: Record<string, unknown> = {};
  for (const line of yamlBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    let value: unknown = trimmed.substring(colonIdx + 1).trim();

    // Handle quoted strings
    if (
      typeof value === "string" &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = (value as string).slice(1, -1);
    }

    // Handle space-delimited lists (allowed-tools)
    if (key === "allowed-tools" && typeof value === "string") {
      value = (value as string).split(/\s+/).filter(Boolean);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Try to read a SKILL.md file from a skill directory.
 * Returns parsed SkillMeta + instructions, or null.
 */
async function loadSkillFile(skillDir: string): Promise<Skill | null> {
  const skillPath = resolve(skillDir, SKILL_FILE);
  try {
    const file = Bun.file(skillPath);
    if (!(await file.exists())) return null;

    const content = await file.text();
    const parsed = parseFrontmatter(content);
    if (!parsed) return null;

    const fm = parsed.frontmatter;
    const name = (fm.name as string) || basename(skillDir);
    const description = (fm.description as string) || "";

    if (!name || !description) return null;

    return {
      name,
      description,
      path: skillPath,
      license: fm.license as string | undefined,
      compatibility: fm.compatibility as string | undefined,
      metadata: fm.metadata as Record<string, string> | undefined,
      allowedTools: fm["allowed-tools"] as string[] | undefined,
      instructions: parsed.body,
    };
  } catch {
    return null;
  }
}

/**
 * List subdirectories of a path.
 * Returns empty array if the path doesn't exist.
 */
async function listSubdirs(dirPath: string): Promise<string[]> {
  try {
    const glob = new Bun.Glob("*/");
    const results: string[] = [];
    for await (const entry of glob.scan({ cwd: dirPath, onlyFiles: false })) {
      results.push(resolve(dirPath, entry));
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Discover all skills from search paths.
 * Returns deduplicated list with project-level skills taking priority.
 */
export async function discoverSkills(cwd?: string): Promise<Skill[]> {
  const workDir = cwd ?? process.cwd();
  const searchPaths = getSearchPaths(workDir);

  const seen = new Set<string>();
  const skills: Skill[] = [];

  for (const searchPath of searchPaths) {
    const subdirs = await listSubdirs(searchPath);
    for (const subdir of subdirs) {
      const skill = await loadSkillFile(subdir);
      if (skill && !seen.has(skill.name)) {
        seen.add(skill.name);
        skills.push(skill);
      }
    }
  }

  return skills;
}

/**
 * Load a single skill by name from any search path.
 */
export async function loadSkill(
  name: string,
  cwd?: string
): Promise<Skill | null> {
  const workDir = cwd ?? process.cwd();
  const searchPaths = getSearchPaths(workDir);

  for (const searchPath of searchPaths) {
    const skillDir = resolve(searchPath, name);
    const skill = await loadSkillFile(skillDir);
    if (skill) return skill;
  }

  return null;
}

/**
 * Extract just the catalog metadata (name + description) without
 * loading full instructions. Used for tier-1 disclosure.
 */
export function toMeta(skill: Skill): SkillMeta {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    license: skill.license,
    compatibility: skill.compatibility,
    metadata: skill.metadata,
    allowedTools: skill.allowedTools,
  };
}
