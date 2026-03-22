import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { discoverSkills, loadSkill, toMeta } from "./loader.ts";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_DIR = resolve(import.meta.dir, "__test_skills__");
const SKILLS_DIR = resolve(TEST_DIR, ".agents/skills");

function writeSkill(name: string, content: string) {
  const dir = resolve(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "SKILL.md"), content);
}

const VALID_SKILL = `---
name: test-skill
description: A test skill for unit testing
license: MIT
---

# Test Skill

This is a test skill with instructions.

## Usage

Do the thing.
`;

const MINIMAL_SKILL = `---
name: minimal
description: Minimal skill
---

Just instructions.
`;

describe("Skill Loader", () => {
  beforeEach(() => {
    mkdirSync(SKILLS_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("discovers skills from .agents/skills/", async () => {
    writeSkill("test-skill", VALID_SKILL);
    writeSkill("minimal", MINIMAL_SKILL);

    const skills = await discoverSkills(TEST_DIR);
    expect(skills).toHaveLength(2);

    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["minimal", "test-skill"]);
  });

  test("parses frontmatter correctly", async () => {
    writeSkill("test-skill", VALID_SKILL);

    const skills = await discoverSkills(TEST_DIR);
    const skill = skills.find((s) => s.name === "test-skill")!;

    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill for unit testing");
    expect(skill.license).toBe("MIT");
    expect(skill.instructions).toContain("# Test Skill");
    expect(skill.instructions).toContain("Do the thing.");
  });

  test("returns empty array when no skills directory exists", async () => {
    rmSync(SKILLS_DIR, { recursive: true, force: true });
    const skills = await discoverSkills(TEST_DIR);
    expect(skills).toHaveLength(0);
  });

  test("skips directories without SKILL.md", async () => {
    mkdirSync(resolve(SKILLS_DIR, "no-skill-file"), { recursive: true });
    writeSkill("real-skill", `---\nname: real-skill\ndescription: A real skill\n---\nHello.`);

    const skills = await discoverSkills(TEST_DIR);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("real-skill");
  });

  test("skips skills with missing name or description", async () => {
    writeSkill("bad-skill", `---\nname: bad\n---\nNo description field.`);
    writeSkill("good-skill", `---\nname: good-skill\ndescription: A good one\n---\nHi.`);

    const skills = await discoverSkills(TEST_DIR);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("good-skill");
  });

  test("skips files without frontmatter", async () => {
    writeSkill("no-frontmatter", "Just plain markdown, no YAML.");
    writeSkill("good", `---\nname: good\ndescription: Good skill\n---\nHi.`);

    const skills = await discoverSkills(TEST_DIR);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("good");
  });

  test("loadSkill loads a single skill by name", async () => {
    writeSkill("target", VALID_SKILL);
    writeSkill("other", MINIMAL_SKILL);

    const skill = await loadSkill("target", TEST_DIR);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("test-skill");
    expect(skill!.instructions).toContain("# Test Skill");
  });

  test("loadSkill returns null for missing skill", async () => {
    const skill = await loadSkill("nonexistent", TEST_DIR);
    expect(skill).toBeNull();
  });

  test("toMeta strips instructions", async () => {
    writeSkill("full", VALID_SKILL);

    const skills = await discoverSkills(TEST_DIR);
    const meta = toMeta(skills[0]);

    expect(meta.name).toBe("test-skill");
    expect(meta.description).toBe("A test skill for unit testing");
    expect((meta as any).instructions).toBeUndefined();
  });

  test("deduplicates skills by name (first path wins)", async () => {
    // Write to .agents/skills (project-level, higher priority)
    writeSkill("dupe", `---\nname: dupe\ndescription: Project-level version\n---\nProject.`);

    // Write to .dough/skills (lower priority)
    const doughSkillsDir = resolve(TEST_DIR, ".dough/skills/dupe");
    mkdirSync(doughSkillsDir, { recursive: true });
    writeFileSync(
      resolve(doughSkillsDir, "SKILL.md"),
      `---\nname: dupe\ndescription: Lower priority version\n---\nDifferent.`
    );

    const skills = await discoverSkills(TEST_DIR);
    const dupes = skills.filter((s) => s.name === "dupe");
    expect(dupes).toHaveLength(1);
    // Project-level (.agents/skills) should win
    expect(dupes[0].description).toBe("Project-level version");
  });

  test("parses allowed-tools as array", async () => {
    writeSkill(
      "with-tools",
      `---\nname: with-tools\ndescription: Has allowed tools\nallowed-tools: Read Write Bash\n---\nInstructions.`
    );

    const skills = await discoverSkills(TEST_DIR);
    const skill = skills.find((s) => s.name === "with-tools")!;
    expect(skill.allowedTools).toEqual(["Read", "Write", "Bash"]);
  });
});
