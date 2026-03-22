import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { SkillManager } from "./manager.ts";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_DIR = resolve(import.meta.dir, "__test_manager__");
const SKILLS_DIR = resolve(TEST_DIR, ".agents/skills");

function writeSkill(name: string, desc: string, body: string = "Instructions.") {
  const dir = resolve(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}`
  );
}

describe("SkillManager", () => {
  let sm: SkillManager;

  beforeEach(() => {
    mkdirSync(SKILLS_DIR, { recursive: true });
    sm = new SkillManager(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("discover finds skills and returns metadata", async () => {
    writeSkill("alpha", "Alpha skill");
    writeSkill("beta", "Beta skill");

    const metas = await sm.discover();
    expect(metas).toHaveLength(2);
    expect(metas.map((m) => m.name).sort()).toEqual(["alpha", "beta"]);
  });

  test("list returns discovered skill names", async () => {
    writeSkill("one", "Skill one");
    await sm.discover();

    expect(sm.list()).toEqual(["one"]);
    expect(sm.has("one")).toBe(true);
    expect(sm.has("nope")).toBe(false);
  });

  test("getCatalog returns metadata without instructions", async () => {
    writeSkill("cat", "Catalog test", "Secret instructions");
    await sm.discover();

    const catalog = sm.getCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe("cat");
    expect((catalog[0] as any).instructions).toBeUndefined();
  });

  test("activate marks skill as active and returns full content", async () => {
    writeSkill("act", "Activatable", "Do this specific thing.");
    await sm.discover();

    expect(sm.isActive("act")).toBe(false);
    const skill = await sm.activate("act");

    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("act");
    expect(skill!.instructions).toContain("Do this specific thing.");
    expect(sm.isActive("act")).toBe(true);
  });

  test("activate returns null for unknown skill", async () => {
    await sm.discover();
    const skill = await sm.activate("nonexistent");
    expect(skill).toBeNull();
  });

  test("deactivate removes skill from active set", async () => {
    writeSkill("temp", "Temporary");
    await sm.discover();

    await sm.activate("temp");
    expect(sm.isActive("temp")).toBe(true);

    sm.deactivate("temp");
    expect(sm.isActive("temp")).toBe(false);
  });

  test("listActive returns only active skill names", async () => {
    writeSkill("a", "Skill A");
    writeSkill("b", "Skill B");
    writeSkill("c", "Skill C");
    await sm.discover();

    await sm.activate("a");
    await sm.activate("c");

    const active = sm.listActive().sort();
    expect(active).toEqual(["a", "c"]);
  });

  test("status returns state for all skills", async () => {
    writeSkill("s1", "Skill 1");
    writeSkill("s2", "Skill 2");
    await sm.discover();
    await sm.activate("s1");

    const statuses = sm.status();
    expect(statuses).toHaveLength(2);

    const s1 = statuses.find((s) => s.name === "s1")!;
    const s2 = statuses.find((s) => s.name === "s2")!;
    expect(s1.state).toBe("active");
    expect(s2.state).toBe("catalog");
  });

  test("getState returns correct state", async () => {
    writeSkill("x", "Skill X");
    await sm.discover();

    expect(sm.getState("x")).toBe("catalog");
    await sm.activate("x");
    expect(sm.getState("x")).toBe("active");
    expect(sm.getState("unknown")).toBeNull();
  });

  test("buildCatalogPrompt generates XML catalog", async () => {
    writeSkill("pdf", "Process PDF documents");
    writeSkill("git", "Git operations helper");
    await sm.discover();

    const prompt = sm.buildCatalogPrompt();
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>pdf</name>");
    expect(prompt).toContain("<description>Process PDF documents</description>");
    expect(prompt).toContain("<name>git</name>");
    expect(prompt).toContain("</available_skills>");
  });

  test("buildCatalogPrompt returns empty string with no skills", async () => {
    await sm.discover();
    expect(sm.buildCatalogPrompt()).toBe("");
  });

  test("buildActivePrompt generates active skill sections", async () => {
    writeSkill("deploy", "Deploy helper", "Run deploy scripts.");
    await sm.discover();
    await sm.activate("deploy");

    const prompt = sm.buildActivePrompt();
    expect(prompt).toContain('<active_skill name="deploy">');
    expect(prompt).toContain("Run deploy scripts.");
    expect(prompt).toContain("</active_skill>");
  });

  test("buildActivePrompt returns empty string with no active skills", async () => {
    writeSkill("idle", "Idle skill");
    await sm.discover();

    expect(sm.buildActivePrompt()).toBe("");
  });

  test("buildContext combines catalog and active sections", async () => {
    writeSkill("avail", "Available skill");
    writeSkill("used", "Used skill", "Use me like this.");
    await sm.discover();
    await sm.activate("used");

    const ctx = sm.buildContext();
    expect(ctx).toContain("# Available Skills");
    expect(ctx).toContain("<available_skills>");
    expect(ctx).toContain("# Active Skills");
    expect(ctx).toContain('<active_skill name="used">');
  });
});
