import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import path from "path";
import os from "os";

let tmpDir: string;
let skillsDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "opsblaze-skills-"));
  skillsDir = path.join(tmpDir, ".claude", "skills");
  vi.stubEnv("HOME", tmpDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

async function createSkillFile(name: string, content: string, disabled = false) {
  const dir = path.join(skillsDir, name);
  await mkdir(dir, { recursive: true });
  const filename = disabled ? "SKILL.md.disabled" : "SKILL.md";
  await writeFile(path.join(dir, filename), content, "utf-8");
}

describe("skills", () => {
  it("returns empty when skills dir does not exist", async () => {
    // Import with cwd pointing to a dir without .claude/skills
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    const mod = await import("../skills.js");
    const skills = await mod.listSkills();
    expect(skills).toEqual([]);
    process.cwd = origCwd;
  });

  it("lists enabled and disabled skills", async () => {
    const content = "---\ndescription: A test skill\n---\n# Test\nDo things.";
    await createSkillFile("enabled-skill", content);
    await createSkillFile("disabled-skill", content, true);

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.resetModules();
    const mod = await import("../skills.js");
    const skills = await mod.listSkills();
    process.cwd = origCwd;

    expect(skills).toHaveLength(2);
    const enabled = skills.find((s) => s.name === "enabled-skill");
    const disabled = skills.find((s) => s.name === "disabled-skill");
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.description).toBe("A test skill");
    expect(disabled?.enabled).toBe(false);
  });

  it("rejects path traversal in toggleSkill", async () => {
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.resetModules();
    const mod = await import("../skills.js");
    process.cwd = origCwd;

    await expect(mod.toggleSkill("../evil", true)).rejects.toThrow("Invalid skill name");
    await expect(mod.toggleSkill("foo/bar", true)).rejects.toThrow("Invalid skill name");
    await expect(mod.toggleSkill("foo\\bar", true)).rejects.toThrow("Invalid skill name");
  });

  it("rejects invalid names in createSkill", async () => {
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.resetModules();
    const mod = await import("../skills.js");
    process.cwd = origCwd;

    await expect(mod.createSkill("bad name!", "content")).rejects.toThrow("lowercase alphanumeric");
    await expect(mod.createSkill("", "content")).rejects.toThrow("lowercase alphanumeric");
    await expect(mod.createSkill("HAS_UPPER", "content")).rejects.toThrow("lowercase alphanumeric");
    await expect(mod.createSkill("has_underscore", "content")).rejects.toThrow(
      "lowercase alphanumeric"
    );
    await expect(mod.createSkill("my-claude-skill", "content")).rejects.toThrow("reserved words");
    await expect(mod.createSkill("anthropic-helper", "content")).rejects.toThrow("reserved words");
  });

  it("listSkills returns path field", async () => {
    await createSkillFile("test-skill", "---\ndescription: test\n---\n# Hello");

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.resetModules();
    const mod = await import("../skills.js");
    const skills = await mod.listSkills();
    process.cwd = origCwd;

    expect(skills).toHaveLength(1);
    expect(skills[0].path).toContain(".claude/skills/test-skill/SKILL.md");
  });

  it("deleteSkill removes directory", async () => {
    await createSkillFile("doomed-skill", "---\ndescription: bye\n---\n# Gone");

    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.resetModules();
    const mod = await import("../skills.js");

    let skills = await mod.listSkills();
    expect(skills).toHaveLength(1);

    await mod.deleteSkill("doomed-skill");

    skills = await mod.listSkills();
    expect(skills).toHaveLength(0);
    process.cwd = origCwd;
  });

  it("deleteSkill throws for nonexistent skill", async () => {
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.resetModules();
    const mod = await import("../skills.js");
    process.cwd = origCwd;

    await expect(mod.deleteSkill("ghost")).rejects.toThrow("not found");
  });

  it("deleteSkill rejects path traversal", async () => {
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.resetModules();
    const mod = await import("../skills.js");
    process.cwd = origCwd;

    await expect(mod.deleteSkill("../evil")).rejects.toThrow("Invalid skill name");
    await expect(mod.deleteSkill("foo/bar")).rejects.toThrow("Invalid skill name");
    await expect(mod.deleteSkill("foo\\bar")).rejects.toThrow("Invalid skill name");
  });
});
