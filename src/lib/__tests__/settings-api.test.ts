import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let mod: typeof import("../settings-api.js");

function mockFetch(status: number, body: unknown = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mockFetchErrorBody(status: number, error: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error }),
    text: async () => JSON.stringify({ error }),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(async () => {
  vi.resetModules();
  mod = await import("../settings-api.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getSettings", () => {
  it("sends GET to /api/settings", async () => {
    const settings = {
      runtime: { claudeModel: "claude-opus-4-6", claudeEffort: "high" },
      system: {
        splunkHost: "localhost",
        splunkPort: 8089,
        splunkScheme: "https",
        splunkAuthMethod: "token",
        serverPort: 3000,
        bindAddress: "127.0.0.1",
        claudeAuthMethod: "cli",
      },
    };
    const fn = mockFetch(200, settings);
    const result = await mod.getSettings();
    expect(fn).toHaveBeenCalledWith("/api/settings", expect.any(Object));
    expect(result).toEqual(settings);
  });

  it("throws on error", async () => {
    mockFetch(500);
    await expect(mod.getSettings()).rejects.toThrow("Failed to get settings: 500");
  });
});

describe("updateSettings", () => {
  it("sends PATCH to /api/settings", async () => {
    const updated = { runtime: { claudeModel: "claude-sonnet-4-20250514", claudeEffort: "low" } };
    const fn = mockFetch(200, updated);
    const result = await mod.updateSettings({ claudeModel: "claude-sonnet-4-20250514" });
    expect(fn).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ claudeModel: "claude-sonnet-4-20250514" }),
      })
    );
    expect(result).toEqual(updated);
  });

  it("throws with error from response body", async () => {
    mockFetchErrorBody(400, "Invalid effort");
    await expect(mod.updateSettings({ claudeEffort: "invalid" })).rejects.toThrow("Invalid effort");
  });
});

describe("deleteSkillApi", () => {
  it("sends DELETE to /api/skills/:name", async () => {
    const fn = mockFetch(200);
    await mod.deleteSkillApi("old-skill");
    expect(fn).toHaveBeenCalledWith(
      "/api/skills/old-skill",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("encodes name in URL", async () => {
    const fn = mockFetch(200);
    await mod.deleteSkillApi("my skill");
    expect(fn).toHaveBeenCalledWith("/api/skills/my%20skill", expect.any(Object));
  });

  it("throws with error from response body", async () => {
    mockFetchErrorBody(404, "Skill 'nope' not found");
    await expect(mod.deleteSkillApi("nope")).rejects.toThrow("Skill 'nope' not found");
  });
});

describe("getConfigPaths", () => {
  it("sends GET to /api/config-paths", async () => {
    const paths = { mcpConfig: "/data/mcp.json", skillsDir: "/skills" };
    const fn = mockFetch(200, paths);
    const result = await mod.getConfigPaths();
    expect(fn).toHaveBeenCalledWith("/api/config-paths", expect.any(Object));
    expect(result).toEqual(paths);
  });

  it("throws on error", async () => {
    mockFetch(500);
    await expect(mod.getConfigPaths()).rejects.toThrow("Failed to get config paths: 500");
  });
});

describe("listMcpServers", () => {
  it("sends GET and returns server list", async () => {
    const servers = [{ name: "s1", config: { command: "node" }, builtIn: false }];
    const fn = mockFetch(200, servers);
    const result = await mod.listMcpServers();
    expect(fn).toHaveBeenCalledWith("/api/mcp-servers", expect.any(Object));
    expect(result).toEqual(servers);
  });
});

describe("addMcpServer", () => {
  it("sends POST with name and config", async () => {
    const fn = mockFetch(200);
    await mod.addMcpServer("test", { command: "node", enabled: true });
    expect(fn).toHaveBeenCalledWith(
      "/api/mcp-servers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "test", config: { command: "node", enabled: true } }),
      })
    );
  });

  it("throws with error from response body", async () => {
    mockFetchErrorBody(400, "Server 'test' already exists");
    await expect(mod.addMcpServer("test", { command: "node", enabled: true })).rejects.toThrow(
      "Server 'test' already exists"
    );
  });
});

describe("updateMcpServer", () => {
  it("sends PUT to /api/mcp-servers/:name", async () => {
    const fn = mockFetch(200);
    await mod.updateMcpServer("my-srv", { command: "node", args: ["v2.js"], enabled: true });
    expect(fn).toHaveBeenCalledWith(
      "/api/mcp-servers/my-srv",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("throws with error from response body", async () => {
    mockFetchErrorBody(404, "Server 'nope' not found");
    await expect(mod.updateMcpServer("nope", { command: "node", enabled: true })).rejects.toThrow(
      "Server 'nope' not found"
    );
  });
});

describe("deleteMcpServer", () => {
  it("sends DELETE to /api/mcp-servers/:name", async () => {
    const fn = mockFetch(200);
    await mod.deleteMcpServer("old-srv");
    expect(fn).toHaveBeenCalledWith(
      "/api/mcp-servers/old-srv",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("encodes name in URL", async () => {
    const fn = mockFetch(200);
    await mod.deleteMcpServer("srv with spaces");
    expect(fn).toHaveBeenCalledWith("/api/mcp-servers/srv%20with%20spaces", expect.any(Object));
  });
});

describe("toggleMcpServer", () => {
  it("sends POST with enabled state", async () => {
    const fn = mockFetch(200);
    await mod.toggleMcpServer("my-srv", false);
    expect(fn).toHaveBeenCalledWith(
      "/api/mcp-servers/my-srv/toggle",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ enabled: false }),
      })
    );
  });
});

describe("testMcpServer", () => {
  it("sends POST and returns probe result", async () => {
    const probe = { status: "connected", tools: [{ name: "tool1" }] };
    const fn = mockFetch(200, probe);
    const result = await mod.testMcpServer("my-srv");
    expect(fn).toHaveBeenCalledWith(
      "/api/mcp-servers/my-srv/test",
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual(probe);
  });
});

describe("listSkillsApi", () => {
  it("sends GET to /api/skills", async () => {
    const skills = [{ name: "splunk-analyst", description: "...", enabled: true, path: "/p" }];
    const fn = mockFetch(200, skills);
    const result = await mod.listSkillsApi();
    expect(fn).toHaveBeenCalledWith("/api/skills", expect.any(Object));
    expect(result).toEqual(skills);
  });
});

describe("toggleSkillApi", () => {
  it("sends POST with enabled state", async () => {
    const fn = mockFetch(200);
    await mod.toggleSkillApi("my-skill", true);
    expect(fn).toHaveBeenCalledWith(
      "/api/skills/my-skill/toggle",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      })
    );
  });

  it("throws with error from response body", async () => {
    mockFetchErrorBody(404, "Skill not found");
    await expect(mod.toggleSkillApi("nope", true)).rejects.toThrow("Skill not found");
  });
});

describe("createSkillApi", () => {
  it("sends POST with name and content", async () => {
    const fn = mockFetch(200);
    await mod.createSkillApi("new-skill", "# Skill content");
    expect(fn).toHaveBeenCalledWith(
      "/api/skills",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "new-skill", content: "# Skill content" }),
      })
    );
  });
});

describe("extractSkillApi", () => {
  it("sends POST with conversationId", async () => {
    const draft = { name: "extracted", description: "desc", content: "# content" };
    const fn = mockFetch(200, draft);
    const result = await mod.extractSkillApi("conv-123");
    expect(fn).toHaveBeenCalledWith(
      "/api/skills/extract",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ conversationId: "conv-123" }),
      })
    );
    expect(result).toEqual(draft);
  });

  it("passes abort signal", async () => {
    const fn = mockFetch(200, { name: "x", description: "x", content: "x" });
    const controller = new AbortController();
    await mod.extractSkillApi("conv-1", controller.signal);
    expect(fn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });
});

describe("refineSkillApi", () => {
  it("sends POST with draft, instruction, and summary", async () => {
    const refined = { name: "refined", description: "better", content: "# better" };
    const fn = mockFetch(200, refined);
    const result = await mod.refineSkillApi("draft text", "make it better", "conv summary");
    expect(fn).toHaveBeenCalledWith(
      "/api/skills/refine",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          draft: "draft text",
          instruction: "make it better",
          conversationSummary: "conv summary",
        }),
      })
    );
    expect(result).toEqual(refined);
  });

  it("throws with error from response body", async () => {
    mockFetchErrorBody(500, "Refinement failed");
    await expect(mod.refineSkillApi("d", "i", "s")).rejects.toThrow("Refinement failed");
  });
});
