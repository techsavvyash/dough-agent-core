/**
 * SkillManager — Manages the lifecycle of AgentSkills.
 *
 * Implements the three-tier progressive disclosure model:
 *  1. Catalog: name + description loaded at startup (~50-100 tokens/skill)
 *  2. Instructions: full SKILL.md body loaded on activation (<5000 tokens)
 *  3. Resources: scripts/references loaded when instructions reference them
 *
 * The catalog is injected into the system prompt so the LLM knows what
 * skills are available. When a skill is activated (by the LLM or user),
 * its full instructions are loaded and appended to the context.
 */

import type { Skill, SkillMeta, SkillStatus, SkillState } from "@dough/protocol";
import { discoverSkills, loadSkill, toMeta } from "./loader.ts";

export class SkillManager {
  /** All discovered skills (full content) */
  private catalog = new Map<string, Skill>();
  /** Currently activated skill names */
  private activeSkills = new Set<string>();
  /** Working directory for discovery */
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  /**
   * Discover skills from the filesystem.
   * Should be called once at startup.
   */
  async discover(): Promise<SkillMeta[]> {
    const skills = await discoverSkills(this.cwd);
    this.catalog.clear();
    for (const skill of skills) {
      this.catalog.set(skill.name, skill);
    }
    return skills.map(toMeta);
  }

  /**
   * Get the catalog of all discovered skills (metadata only).
   */
  getCatalog(): SkillMeta[] {
    return Array.from(this.catalog.values()).map(toMeta);
  }

  /**
   * Activate a skill by name. Returns the full instructions,
   * or null if the skill is not found.
   */
  async activate(name: string): Promise<Skill | null> {
    let skill = this.catalog.get(name);
    if (!skill) {
      // Try loading from disk (might be newly installed)
      skill = await loadSkill(name, this.cwd) ?? undefined;
      if (skill) {
        this.catalog.set(skill.name, skill);
      }
    }
    if (!skill) return null;

    this.activeSkills.add(name);
    return skill;
  }

  /**
   * Deactivate a skill (remove from active context).
   */
  deactivate(name: string): boolean {
    return this.activeSkills.delete(name);
  }

  /**
   * Check if a skill is currently active.
   */
  isActive(name: string): boolean {
    return this.activeSkills.has(name);
  }

  /**
   * Get the state of a skill.
   */
  getState(name: string): SkillState | null {
    if (!this.catalog.has(name)) return null;
    return this.activeSkills.has(name) ? "active" : "catalog";
  }

  /**
   * Get status of all skills (for wire protocol).
   */
  status(): SkillStatus[] {
    return Array.from(this.catalog.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      state: this.activeSkills.has(skill.name) ? "active" as const : "catalog" as const,
      path: skill.path,
    }));
  }

  /**
   * List all discovered skill names.
   */
  list(): string[] {
    return Array.from(this.catalog.keys());
  }

  /**
   * List currently active skill names.
   */
  listActive(): string[] {
    return Array.from(this.activeSkills);
  }

  /**
   * Check if a skill exists in the catalog.
   */
  has(name: string): boolean {
    return this.catalog.has(name);
  }

  /**
   * Build the catalog section for system prompt injection.
   * This is the tier-1 disclosure: just names and descriptions.
   */
  buildCatalogPrompt(): string {
    if (this.catalog.size === 0) return "";

    const entries = Array.from(this.catalog.values())
      .map(
        (s) =>
          `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n  </skill>`
      )
      .join("\n");

    return `<available_skills>\n${entries}\n</available_skills>`;
  }

  /**
   * Build the active skills section for system prompt injection.
   * This is the tier-2 disclosure: full instructions of activated skills.
   */
  buildActivePrompt(): string {
    if (this.activeSkills.size === 0) return "";

    const sections = Array.from(this.activeSkills)
      .map((name) => {
        const skill = this.catalog.get(name);
        if (!skill) return null;
        return `<active_skill name="${skill.name}">\n${skill.instructions}\n</active_skill>`;
      })
      .filter(Boolean);

    if (sections.length === 0) return "";
    return sections.join("\n\n");
  }

  /**
   * Build the complete skills context for system prompt injection.
   * Combines catalog (tier 1) + active instructions (tier 2).
   */
  buildContext(): string {
    const parts: string[] = [];

    const catalog = this.buildCatalogPrompt();
    if (catalog) {
      parts.push(
        "# Available Skills\n\nThe following skills are available. To use a skill, read its SKILL.md file or ask the user to activate it.\n\n" +
          catalog
      );
    }

    const active = this.buildActivePrompt();
    if (active) {
      parts.push("# Active Skills\n\n" + active);
    }

    return parts.join("\n\n");
  }
}
