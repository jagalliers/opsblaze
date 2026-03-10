import { readFile, readdir, rename, stat, mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import { logger } from "./logger.js";

export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  path: string;
}

const SKILLS_DIR = path.resolve(process.cwd(), ".claude", "skills");
export const SKILLS_DIR_PATH = SKILLS_DIR;
const SKILL_FILE = "SKILL.md";
const DISABLED_FILE = "SKILL.md.disabled";

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    frontmatter[key] = value;
  }
  return frontmatter;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export type SkillValidationResult = { skills: string[] | undefined } | { error: string };

export async function validateSkillsParam(rawSkills: unknown): Promise<SkillValidationResult> {
  if (rawSkills === undefined) {
    return { skills: undefined };
  }
  if (!Array.isArray(rawSkills) || rawSkills.some((s) => typeof s !== "string")) {
    return { error: "skills must be an array of strings" };
  }
  if (rawSkills.length === 0) {
    return { error: "skills array must not be empty" };
  }
  const knownSkills = await listSkills();
  const enabledNames = new Set(knownSkills.filter((s) => s.enabled).map((s) => s.name));
  const invalid = (rawSkills as string[]).filter((s) => !enabledNames.has(s));
  if (invalid.length > 0) {
    return { error: `Unknown or disabled skills: ${invalid.join(", ")}` };
  }
  return { skills: rawSkills as string[] };
}

export async function listSkills(): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  let entries: string[];
  try {
    entries = await readdir(SKILLS_DIR);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    logger.error({ err }, "failed to read skills directory");
    return [];
  }

  for (const entry of entries) {
    const dir = path.join(SKILLS_DIR, entry);
    if (!(await isDirectory(dir))) continue;

    const enabledPath = path.join(dir, SKILL_FILE);
    const disabledPath = path.join(dir, DISABLED_FILE);

    let filePath: string | null = null;
    let enabled = false;

    try {
      await stat(enabledPath);
      filePath = enabledPath;
      enabled = true;
    } catch {
      try {
        await stat(disabledPath);
        filePath = disabledPath;
        enabled = false;
      } catch {
        continue;
      }
    }

    let description = "";
    try {
      const content = await readFile(filePath, "utf-8");
      const fm = parseFrontmatter(content);
      description = fm.description ?? "";
    } catch {
      // Use empty description if file can't be read
    }

    const relativePath = path.relative(process.cwd(), filePath);

    skills.push({
      name: entry,
      description,
      enabled,
      path: relativePath,
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

const RESERVED_WORDS = ["anthropic", "claude"];

export async function createSkill(name: string, content: string): Promise<void> {
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    throw new Error("Skill name must be lowercase alphanumeric with hyphens (a-z, 0-9, -)");
  }
  if (RESERVED_WORDS.some((w) => name.includes(w))) {
    throw new Error(`Skill name must not contain reserved words: ${RESERVED_WORDS.join(", ")}`);
  }

  const fm = parseFrontmatter(content);
  if (fm.description && fm.description.length > 1024) {
    throw new Error("Skill description must not exceed 1024 characters");
  }

  const dir = path.join(SKILLS_DIR, name);
  if (await isDirectory(dir)) {
    throw new Error(`Skill '${name}' already exists`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, SKILL_FILE), content, "utf-8");
  logger.info({ name }, "skill created");
}

export async function deleteSkill(name: string): Promise<void> {
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid skill name: '${name}'`);
  }
  const dir = path.join(SKILLS_DIR, name);
  if (!(await isDirectory(dir))) {
    throw new Error(`Skill '${name}' not found`);
  }
  await rm(dir, { recursive: true });
  logger.info({ name }, "skill deleted");
}

export async function toggleSkill(name: string, enabled: boolean): Promise<void> {
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid skill name: '${name}'`);
  }
  const dir = path.join(SKILLS_DIR, name);
  if (!(await isDirectory(dir))) {
    throw new Error(`Skill '${name}' not found`);
  }

  const enabledPath = path.join(dir, SKILL_FILE);
  const disabledPath = path.join(dir, DISABLED_FILE);

  if (enabled) {
    try {
      await stat(disabledPath);
      await rename(disabledPath, enabledPath);
      logger.info({ name }, "skill enabled");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Already enabled or doesn't exist
        try {
          await stat(enabledPath);
          return; // Already enabled
        } catch {
          throw new Error(`Skill '${name}' has no SKILL.md file`);
        }
      }
      throw err;
    }
  } else {
    try {
      await stat(enabledPath);
      await rename(enabledPath, disabledPath);
      logger.info({ name }, "skill disabled");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        try {
          await stat(disabledPath);
          return; // Already disabled
        } catch {
          throw new Error(`Skill '${name}' has no SKILL.md file`);
        }
      }
      throw err;
    }
  }
}
