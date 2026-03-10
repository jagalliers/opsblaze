import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import path from "path";
import os from "os";

let tmpDir: string;
let skillsDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "opsblaze-chat-skills-"));
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

const SKILL_CONTENT = "---\ndescription: A test skill\n---\n# Test\nDo things.";

describe("validateSkillsParam", () => {
  async function loadValidator() {
    const origCwd = process.cwd;
    process.cwd = () => tmpDir;
    vi.resetModules();
    const mod = await import("../skills.js");
    process.cwd = origCwd;
    return mod.validateSkillsParam;
  }

  it("returns undefined skills when rawSkills is omitted", async () => {
    const validate = await loadValidator();
    const result = await validate(undefined);
    expect(result).toEqual({ skills: undefined });
  });

  it("rejects non-array skills (string)", async () => {
    const validate = await loadValidator();
    const result = await validate("splunk-analyst");
    expect(result).toEqual({ error: "skills must be an array of strings" });
  });

  it("rejects non-array skills (number)", async () => {
    const validate = await loadValidator();
    const result = await validate(42);
    expect(result).toEqual({ error: "skills must be an array of strings" });
  });

  it("rejects non-array skills (object)", async () => {
    const validate = await loadValidator();
    const result = await validate({ name: "splunk-analyst" });
    expect(result).toEqual({ error: "skills must be an array of strings" });
  });

  it("rejects array with non-string elements", async () => {
    const validate = await loadValidator();
    const result = await validate([42]);
    expect(result).toEqual({ error: "skills must be an array of strings" });
  });

  it("rejects array with mixed string and non-string", async () => {
    const validate = await loadValidator();
    const result = await validate(["valid", 42, true]);
    expect(result).toEqual({ error: "skills must be an array of strings" });
  });

  it("rejects empty array", async () => {
    const validate = await loadValidator();
    const result = await validate([]);
    expect(result).toEqual({ error: "skills array must not be empty" });
  });

  it("rejects unknown skill names", async () => {
    await createSkillFile("real-skill", SKILL_CONTENT);

    const validate = await loadValidator();
    const result = await validate(["nonexistent"]);
    expect(result).toEqual({ error: "Unknown or disabled skills: nonexistent" });
  });

  it("includes all unknown names in the error", async () => {
    await createSkillFile("real-skill", SKILL_CONTENT);

    const validate = await loadValidator();
    const result = await validate(["fake-one", "fake-two"]);
    expect(result).toEqual({
      error: "Unknown or disabled skills: fake-one, fake-two",
    });
  });

  it("rejects disabled skills", async () => {
    await createSkillFile("disabled-skill", SKILL_CONTENT, true);

    const validate = await loadValidator();
    const result = await validate(["disabled-skill"]);
    expect(result).toEqual({
      error: "Unknown or disabled skills: disabled-skill",
    });
  });

  it("rejects mix of unknown and disabled skills", async () => {
    await createSkillFile("disabled-skill", SKILL_CONTENT, true);

    const validate = await loadValidator();
    const result = await validate(["disabled-skill", "totally-fake"]);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("disabled-skill");
      expect(result.error).toContain("totally-fake");
    }
  });

  it("accepts valid enabled skill", async () => {
    await createSkillFile("splunk-analyst", SKILL_CONTENT);

    const validate = await loadValidator();
    const result = await validate(["splunk-analyst"]);
    expect(result).toEqual({ skills: ["splunk-analyst"] });
  });

  it("accepts multiple valid enabled skills", async () => {
    await createSkillFile("skill-a", SKILL_CONTENT);
    await createSkillFile("skill-b", SKILL_CONTENT);

    const validate = await loadValidator();
    const result = await validate(["skill-a", "skill-b"]);
    expect(result).toEqual({ skills: ["skill-a", "skill-b"] });
  });

  it("allows duplicate skill names (documents current behavior)", async () => {
    await createSkillFile("skill-a", SKILL_CONTENT);

    const validate = await loadValidator();
    const result = await validate(["skill-a", "skill-a"]);
    expect(result).toEqual({ skills: ["skill-a", "skill-a"] });
  });

  it("rejects when one valid and one unknown skill are provided", async () => {
    await createSkillFile("real-skill", SKILL_CONTENT);

    const validate = await loadValidator();
    const result = await validate(["real-skill", "fake-skill"]);
    expect(result).toEqual({ error: "Unknown or disabled skills: fake-skill" });
  });

  it("rejects null", async () => {
    const validate = await loadValidator();
    const result = await validate(null);
    expect(result).toEqual({ error: "skills must be an array of strings" });
  });

  it("rejects boolean", async () => {
    const validate = await loadValidator();
    const result = await validate(true);
    expect(result).toEqual({ error: "skills must be an array of strings" });
  });
});
