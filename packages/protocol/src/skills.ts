/**
 * AgentSkills format types.
 *
 * Based on the open specification at https://agentskills.io/specification
 * Skills are directories containing a SKILL.md file with YAML frontmatter
 * and Markdown instructions.
 */

/** Parsed SKILL.md frontmatter metadata */
export interface SkillMeta {
  /** Unique skill name (lowercase, hyphens, max 64 chars) */
  name: string;
  /** What the skill does and when to use it (max 1024 chars) */
  description: string;
  /** Path to the SKILL.md file on disk */
  path: string;
  /** License info (optional) */
  license?: string;
  /** Environment requirements (optional, max 500 chars) */
  compatibility?: string;
  /** Arbitrary key-value metadata */
  metadata?: Record<string, string>;
  /** Pre-approved tool names (experimental) */
  allowedTools?: string[];
}

/** Full skill content (loaded on activation) */
export interface Skill extends SkillMeta {
  /** Full Markdown body (instructions after frontmatter) */
  instructions: string;
}

/** Activation state of a skill in the current session */
export type SkillState = "catalog" | "active";

/** Skill status for wire protocol */
export interface SkillStatus {
  name: string;
  description: string;
  state: SkillState;
  path: string;
}
