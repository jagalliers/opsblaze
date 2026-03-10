import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.stubEnv("SPLUNK_HOST", "splunk.example.com");
  vi.stubEnv("SPLUNK_PORT", "8089");
  vi.stubEnv("PORT", "3000");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("validateEnv", () => {
  it("succeeds with valid minimal config", async () => {
    const { validateEnv } = await import("../env.js");
    const result = validateEnv();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.SPLUNK_HOST).toBe("splunk.example.com");
      expect(result.env.SPLUNK_PORT).toBe(8089);
      expect(result.env.PORT).toBe(3000);
      expect(result.env.CLAUDE_MODEL).toBe("claude-opus-4-6");
    }
  });

  it("fails when SPLUNK_HOST is missing", async () => {
    vi.stubEnv("SPLUNK_HOST", "");
    vi.resetModules();
    const { validateEnv } = await import("../env.js");
    const result = validateEnv();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("SPLUNK_HOST"))).toBe(true);
    }
  });

  it("fails when PORT is not a valid number", async () => {
    vi.stubEnv("PORT", "not-a-number");
    vi.resetModules();
    const { validateEnv } = await import("../env.js");
    const result = validateEnv();
    expect(result.ok).toBe(false);
  });

  it("fails when SPLUNK_PORT is out of range", async () => {
    vi.stubEnv("SPLUNK_PORT", "99999");
    vi.resetModules();
    const { validateEnv } = await import("../env.js");
    const result = validateEnv();
    expect(result.ok).toBe(false);
  });

  it("applies defaults for optional fields", async () => {
    const { validateEnv } = await import("../env.js");
    const result = validateEnv();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.CLAUDE_EFFORT).toBe("high");
      expect(result.env.OPSBLAZE_STREAM_TIMEOUT_MS).toBe(300_000);
      expect(result.env.OPSBLAZE_MAX_TURNS).toBe(30);
    }
  });

  it("rejects invalid CLAUDE_EFFORT", async () => {
    vi.stubEnv("CLAUDE_EFFORT", "extreme");
    vi.resetModules();
    const { validateEnv } = await import("../env.js");
    const result = validateEnv();
    expect(result.ok).toBe(false);
  });
});
