import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import os from "os";

let tmpDir: string;
let mod: typeof import("../runtime-settings.js");

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "opsblaze-settings-"));
  vi.stubEnv("OPSBLAZE_DATA_DIR", path.join(tmpDir, "conversations"));
  vi.resetModules();
  mod = await import("../runtime-settings.js");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("loadRuntimeSettings", () => {
  it("returns empty defaults when file is missing", async () => {
    const settings = await mod.loadRuntimeSettings();
    expect(settings).toEqual({});
  });

  it("returns parsed content when file exists", async () => {
    const settingsPath = path.join(tmpDir, "runtime-settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({ claudeModel: "claude-sonnet-4-20250514", claudeEffort: "low" }),
      "utf-8"
    );

    const settings = await mod.loadRuntimeSettings();
    expect(settings.claudeModel).toBe("claude-sonnet-4-20250514");
    expect(settings.claudeEffort).toBe("low");
  });
});

describe("updateRuntimeSettings", () => {
  it("merges partial updates and persists", async () => {
    const result = await mod.updateRuntimeSettings({ claudeModel: "claude-sonnet-4-20250514" });
    expect(result.claudeModel).toBe("claude-sonnet-4-20250514");
    expect(result.claudeEffort).toBeUndefined();

    const settingsPath = path.join(tmpDir, "runtime-settings.json");
    const raw = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(raw.claudeModel).toBe("claude-sonnet-4-20250514");
  });

  it("merges with existing settings", async () => {
    await mod.updateRuntimeSettings({ claudeModel: "model-a" });
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    const result = await mod.updateRuntimeSettings({ claudeEffort: "max" });
    expect(result.claudeModel).toBe("model-a");
    expect(result.claudeEffort).toBe("max");
  });

  it("rejects invalid effort values", async () => {
    await expect(mod.updateRuntimeSettings({ claudeEffort: "extreme" as any })).rejects.toThrow();
  });
});

describe("getClaudeModel", () => {
  it("falls back to env var when no runtime setting", async () => {
    vi.stubEnv("CLAUDE_MODEL", "env-model");
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    expect(await mod.getClaudeModel()).toBe("env-model");
  });

  it("falls back to default when no env or runtime setting", async () => {
    expect(await mod.getClaudeModel()).toBe("claude-opus-4-6");
  });

  it("prefers runtime setting over env var", async () => {
    vi.stubEnv("CLAUDE_MODEL", "env-model");
    await mod.updateRuntimeSettings({ claudeModel: "runtime-model" });
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    expect(await mod.getClaudeModel()).toBe("runtime-model");
  });
});

describe("getClaudeEffort", () => {
  it("falls back to env var when no runtime setting", async () => {
    vi.stubEnv("CLAUDE_EFFORT", "low");
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    expect(await mod.getClaudeEffort()).toBe("low");
  });

  it("falls back to default when no env or runtime setting", async () => {
    expect(await mod.getClaudeEffort()).toBe("high");
  });

  it("prefers runtime setting over env var", async () => {
    vi.stubEnv("CLAUDE_EFFORT", "low");
    await mod.updateRuntimeSettings({ claudeEffort: "max" });
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    expect(await mod.getClaudeEffort()).toBe("max");
  });
});
