import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import path from "path";
import os from "os";

let tmpDir: string;
let mod: typeof import("../mcp-config.js");

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "opsblaze-mcp-"));
  vi.stubEnv("OPSBLAZE_DATA_DIR", path.join(tmpDir, "conversations"));
  vi.stubEnv("SPLUNK_HOST", "splunk.example.com");
  vi.stubEnv("SPLUNK_PORT", "8089");
  vi.stubEnv("SPLUNK_TOKEN", "tok_secret");
  vi.resetModules();
  mod = await import("../mcp-config.js");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("listMcpServers", () => {
  it("returns built-in splunk server when config is empty", async () => {
    const servers = await mod.listMcpServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("opsblaze-splunk");
    expect(servers[0].builtIn).toBe(true);
  });

  it("redacts env values in listed servers", async () => {
    const servers = await mod.listMcpServers();
    const splunk = servers[0];
    const env = (splunk.config as { env?: Record<string, string> }).env;
    expect(env).toBeDefined();
    for (const val of Object.values(env!)) {
      expect(val).toBe("••••••");
    }
  });

  it("includes user-added servers", async () => {
    await mod.addMcpServer("my-server", {
      command: "node",
      args: ["server.js"],
      enabled: true,
    });
    const servers = await mod.listMcpServers();
    expect(servers).toHaveLength(2);
    const userServer = servers.find((s) => s.name === "my-server");
    expect(userServer).toBeDefined();
    expect(userServer!.builtIn).toBe(false);
  });
});

describe("getMcpServer", () => {
  it("returns built-in server with unredacted config", async () => {
    const server = await mod.getMcpServer("opsblaze-splunk");
    expect(server).not.toBeNull();
    expect(server!.builtIn).toBe(true);
    const env = (server!.config as { env?: Record<string, string> }).env;
    expect(env?.SPLUNK_TOKEN).toBe("tok_secret");
  });

  it("returns null for non-existent server", async () => {
    const server = await mod.getMcpServer("nonexistent");
    expect(server).toBeNull();
  });
});

describe("addMcpServer", () => {
  it("adds a valid stdio server", async () => {
    await mod.addMcpServer("test-server", {
      command: "npx",
      args: ["some-mcp-server"],
      enabled: true,
    });
    const server = await mod.getMcpServer("test-server");
    expect(server).not.toBeNull();
    expect(server!.config.enabled).toBe(true);
  });

  it("adds a valid HTTP server", async () => {
    await mod.addMcpServer("http-srv", {
      type: "http",
      url: "https://example.com/mcp",
      enabled: true,
    });
    const server = await mod.getMcpServer("http-srv");
    expect(server).not.toBeNull();
    expect(server!.config.type).toBe("http");
  });

  it("adds a valid SSE server", async () => {
    await mod.addMcpServer("sse-srv", {
      type: "sse",
      url: "https://example.com/sse",
      enabled: true,
    });
    const server = await mod.getMcpServer("sse-srv");
    expect(server).not.toBeNull();
    expect(server!.config.type).toBe("sse");
  });

  it("rejects duplicate server name", async () => {
    await mod.addMcpServer("dupe", { command: "node", args: [], enabled: true });
    await expect(
      mod.addMcpServer("dupe", { command: "node", args: [], enabled: true })
    ).rejects.toThrow("already exists");
  });

  it("rejects modifying built-in server", async () => {
    await expect(
      mod.addMcpServer("opsblaze-splunk", { command: "node", args: [], enabled: true })
    ).rejects.toThrow("Cannot modify built-in");
  });

  it("persists config to disk", async () => {
    await mod.addMcpServer("persist-test", {
      command: "python3",
      args: ["server.py"],
      enabled: true,
    });
    const raw = await readFile(mod.MCP_CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    expect(config.servers["persist-test"]).toBeDefined();
  });
});

describe("updateMcpServer", () => {
  it("updates an existing server", async () => {
    await mod.addMcpServer("upd", { command: "node", args: ["v1.js"], enabled: true });
    await mod.updateMcpServer("upd", { command: "node", args: ["v2.js"], enabled: false });
    const server = await mod.getMcpServer("upd");
    expect((server!.config as { args?: string[] }).args).toEqual(["v2.js"]);
    expect(server!.config.enabled).toBe(false);
  });

  it("rejects updating non-existent server", async () => {
    await expect(
      mod.updateMcpServer("ghost", { command: "node", args: [], enabled: true })
    ).rejects.toThrow("not found");
  });

  it("rejects updating built-in server", async () => {
    await expect(
      mod.updateMcpServer("opsblaze-splunk", { command: "node", args: [], enabled: true })
    ).rejects.toThrow("Cannot modify built-in");
  });

  it("merges redacted env values with existing config", async () => {
    await mod.addMcpServer("env-test", {
      command: "node",
      args: ["s.js"],
      env: { API_KEY: "real-secret", OTHER: "visible" },
      enabled: true,
    });
    await mod.updateMcpServer("env-test", {
      command: "node",
      args: ["s.js"],
      env: { API_KEY: "••••••", OTHER: "changed" },
      enabled: true,
    });
    const server = await mod.getMcpServer("env-test");
    const env = (server!.config as { env?: Record<string, string> }).env!;
    expect(env.API_KEY).toBe("real-secret");
    expect(env.OTHER).toBe("changed");
  });

  it("replaces non-sentinel env values", async () => {
    await mod.addMcpServer("env-replace", {
      command: "node",
      args: [],
      env: { KEY: "old-value" },
      enabled: true,
    });
    await mod.updateMcpServer("env-replace", {
      command: "node",
      args: [],
      env: { KEY: "new-value" },
      enabled: true,
    });
    const server = await mod.getMcpServer("env-replace");
    const env = (server!.config as { env?: Record<string, string> }).env!;
    expect(env.KEY).toBe("new-value");
  });

  it("merges redacted header values with existing config", async () => {
    await mod.addMcpServer("hdr-test", {
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer secret" },
      enabled: true,
    });
    await mod.updateMcpServer("hdr-test", {
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "••••••" },
      enabled: true,
    });
    const server = await mod.getMcpServer("hdr-test");
    const headers = (server!.config as { headers?: Record<string, string> }).headers!;
    expect(headers.Authorization).toBe("Bearer secret");
  });
});

describe("deleteMcpServer", () => {
  it("deletes an existing server", async () => {
    await mod.addMcpServer("del-me", { command: "node", args: [], enabled: true });
    await mod.deleteMcpServer("del-me");
    const server = await mod.getMcpServer("del-me");
    expect(server).toBeNull();
  });

  it("rejects deleting non-existent server", async () => {
    await expect(mod.deleteMcpServer("nope")).rejects.toThrow("not found");
  });

  it("rejects deleting built-in server", async () => {
    await expect(mod.deleteMcpServer("opsblaze-splunk")).rejects.toThrow("Cannot delete built-in");
  });
});

describe("toggleMcpServer", () => {
  it("toggles server enabled state", async () => {
    await mod.addMcpServer("tog", { command: "node", args: [], enabled: true });
    await mod.toggleMcpServer("tog", false);
    let server = await mod.getMcpServer("tog");
    expect(server!.config.enabled).toBe(false);

    await mod.toggleMcpServer("tog", true);
    server = await mod.getMcpServer("tog");
    expect(server!.config.enabled).toBe(true);
  });

  it("rejects toggling non-existent server", async () => {
    await expect(mod.toggleMcpServer("nope", true)).rejects.toThrow("not found");
  });

  it("rejects toggling built-in server", async () => {
    await expect(mod.toggleMcpServer("opsblaze-splunk", false)).rejects.toThrow(
      "Cannot toggle built-in"
    );
  });
});

describe("validation: security blocklists", () => {
  it("rejects disallowed commands", async () => {
    await expect(
      mod.addMcpServer("bad", { command: "bash", args: [], enabled: true })
    ).rejects.toThrow("not allowed");
  });

  it("rejects blocked env vars", async () => {
    await expect(
      mod.addMcpServer("bad-env", {
        command: "node",
        args: [],
        env: { NODE_OPTIONS: "--inspect" },
        enabled: true,
      })
    ).rejects.toThrow("blocked for security");
  });

  it("rejects blocked arg patterns", async () => {
    await expect(
      mod.addMcpServer("bad-args", {
        command: "node",
        args: ["--require", "evil.js"],
        enabled: true,
      })
    ).rejects.toThrow("not allowed for security");
  });

  it("rejects --eval arg", async () => {
    await expect(
      mod.addMcpServer("eval", {
        command: "node",
        args: ["--eval=process.exit()"],
        enabled: true,
      })
    ).rejects.toThrow("not allowed for security");
  });

  it("rejects non-http/https URLs", async () => {
    await expect(
      mod.addMcpServer("ftp", {
        type: "http",
        url: "ftp://example.com",
        enabled: true,
      })
    ).rejects.toThrow("http or https");
  });

  it("rejects invalid URLs", async () => {
    await expect(
      mod.addMcpServer("invalid", { type: "http", url: "not-a-url", enabled: true })
    ).rejects.toThrow("valid URL");
  });

  it("rejects unknown server type", async () => {
    await expect(
      mod.addMcpServer("weird", { type: "websocket" as any, url: "ws://x", enabled: true })
    ).rejects.toThrow("Unknown server type");
  });

  it("allows all permitted commands", async () => {
    const commands = [
      "npx",
      "node",
      "tsx",
      "python",
      "python3",
      "uvx",
      "uv",
      "deno",
      "bun",
      "docker",
    ];
    for (const command of commands) {
      const name = `cmd-${command}`;
      await mod.addMcpServer(name, { command, args: [], enabled: true });
      const server = await mod.getMcpServer(name);
      expect(server).not.toBeNull();
    }
  });
});

describe("buildMcpServersForQuery", () => {
  it("includes built-in splunk server", async () => {
    const { mcpServers, allowedTools } = await mod.buildMcpServersForQuery();
    expect(mcpServers["opsblaze-splunk"]).toBeDefined();
    expect(allowedTools).toContain("Skill");
    expect(allowedTools).toContain("mcp__opsblaze-splunk__*");
  });

  it("includes enabled user servers", async () => {
    await mod.addMcpServer("extra", { command: "node", args: ["s.js"], enabled: true });
    const { mcpServers, allowedTools } = await mod.buildMcpServersForQuery();
    expect(mcpServers["extra"]).toBeDefined();
    expect(allowedTools).toContain("mcp__extra__*");
  });

  it("excludes disabled user servers", async () => {
    await mod.addMcpServer("off", { command: "node", args: ["s.js"], enabled: true });
    await mod.toggleMcpServer("off", false);
    const { mcpServers } = await mod.buildMcpServersForQuery();
    expect(mcpServers["off"]).toBeUndefined();
  });

  it("builds http servers with url and headers", async () => {
    await mod.addMcpServer("h", {
      type: "http",
      url: "https://api.example.com/mcp",
      headers: { "X-Key": "val" },
      enabled: true,
    });
    const { mcpServers } = await mod.buildMcpServersForQuery();
    expect(mcpServers["h"]).toEqual({
      type: "http",
      url: "https://api.example.com/mcp",
      headers: { "X-Key": "val" },
    });
  });

  it("builds sse servers with url and headers", async () => {
    await mod.addMcpServer("s", {
      type: "sse",
      url: "https://api.example.com/sse",
      headers: { Authorization: "Bearer tok" },
      enabled: true,
    });
    const { mcpServers } = await mod.buildMcpServersForQuery();
    expect(mcpServers["s"]).toEqual({
      type: "sse",
      url: "https://api.example.com/sse",
      headers: { Authorization: "Bearer tok" },
    });
  });
});
