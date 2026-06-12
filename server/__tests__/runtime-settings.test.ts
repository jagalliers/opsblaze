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
    expect(await mod.getClaudeModel()).toBe("claude-opus-4-8");
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

describe("getMaxTurns", () => {
  it("falls back to env var when no runtime setting", async () => {
    vi.stubEnv("OPSBLAZE_MAX_TURNS", "50");
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    expect(await mod.getMaxTurns()).toBe(50);
  });

  it("falls back to default (120) when neither is set", async () => {
    expect(await mod.getMaxTurns()).toBe(120);
  });

  it("prefers runtime setting over env var", async () => {
    vi.stubEnv("OPSBLAZE_MAX_TURNS", "50");
    await mod.updateRuntimeSettings({ maxTurns: 100 });
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    expect(await mod.getMaxTurns()).toBe(100);
  });
});

describe("getStreamTimeoutMs", () => {
  it("falls back to env var when no runtime setting", async () => {
    vi.stubEnv("OPSBLAZE_STREAM_TIMEOUT_MS", "600000");
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    expect(await mod.getStreamTimeoutMs()).toBe(600000);
  });

  it("falls back to default (900000) when neither is set", async () => {
    expect(await mod.getStreamTimeoutMs()).toBe(900000);
  });

  it("prefers runtime setting over env var", async () => {
    vi.stubEnv("OPSBLAZE_STREAM_TIMEOUT_MS", "600000");
    await mod.updateRuntimeSettings({ streamTimeoutMs: 900000 });
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    expect(await mod.getStreamTimeoutMs()).toBe(900000);
  });
});

describe("updateRuntimeSettings validation: maxTurns and streamTimeoutMs", () => {
  it("rejects maxTurns of 0", async () => {
    await expect(mod.updateRuntimeSettings({ maxTurns: 0 })).rejects.toThrow();
  });

  it("rejects maxTurns above 200", async () => {
    await expect(mod.updateRuntimeSettings({ maxTurns: 201 })).rejects.toThrow();
  });

  it("rejects negative maxTurns", async () => {
    await expect(mod.updateRuntimeSettings({ maxTurns: -1 })).rejects.toThrow();
  });

  it("rejects streamTimeoutMs below 30000", async () => {
    await expect(mod.updateRuntimeSettings({ streamTimeoutMs: 29999 })).rejects.toThrow();
  });

  it("rejects streamTimeoutMs above 1800000", async () => {
    await expect(mod.updateRuntimeSettings({ streamTimeoutMs: 1800001 })).rejects.toThrow();
  });

  it("accepts valid maxTurns and streamTimeoutMs values and persists them", async () => {
    const result = await mod.updateRuntimeSettings({ maxTurns: 50, streamTimeoutMs: 600000 });
    expect(result.maxTurns).toBe(50);
    expect(result.streamTimeoutMs).toBe(600000);

    vi.resetModules();
    mod = await import("../runtime-settings.js");
    const loaded = await mod.loadRuntimeSettings();
    expect(loaded.maxTurns).toBe(50);
    expect(loaded.streamTimeoutMs).toBe(600000);
  });

  it("merges maxTurns/streamTimeoutMs with existing claudeModel/claudeEffort", async () => {
    await mod.updateRuntimeSettings({ claudeModel: "test-model", claudeEffort: "low" });
    vi.resetModules();
    mod = await import("../runtime-settings.js");
    const result = await mod.updateRuntimeSettings({ maxTurns: 75, streamTimeoutMs: 120000 });
    expect(result.claudeModel).toBe("test-model");
    expect(result.claudeEffort).toBe("low");
    expect(result.maxTurns).toBe(75);
    expect(result.streamTimeoutMs).toBe(120000);
  });
});
