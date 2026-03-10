import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let mod: typeof import("../splunk-client.js");

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("SPLUNK_HOST", "splunk.test.com");
  vi.stubEnv("SPLUNK_PORT", "8089");
  vi.stubEnv("SPLUNK_TOKEN", "test-token-123");
  mod = await import("../splunk-client.js");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getSplunkConfig", () => {
  it("reads config from environment variables", () => {
    const config = mod.getSplunkConfig();
    expect(config.host).toBe("splunk.test.com");
    expect(config.port).toBe(8089);
    expect(config.scheme).toBe("https");
    expect(config.token).toBe("test-token-123");
    expect(config.verifySsl).toBe(true);
  });

  it("throws when SPLUNK_HOST is not set", async () => {
    vi.stubEnv("SPLUNK_HOST", "");
    vi.resetModules();
    const freshMod = await import("../splunk-client.js");
    expect(() => freshMod.getSplunkConfig()).toThrow("SPLUNK_HOST");
  });

  it("uses default port 8089 when not specified", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("SPLUNK_HOST", "host.test");
    vi.resetModules();
    const freshMod = await import("../splunk-client.js");
    const config = freshMod.getSplunkConfig();
    expect(config.port).toBe(8089);
  });

  it("reads scheme from SPLUNK_SCHEME", async () => {
    vi.stubEnv("SPLUNK_SCHEME", "http");
    vi.resetModules();
    const freshMod = await import("../splunk-client.js");
    const config = freshMod.getSplunkConfig();
    expect(config.scheme).toBe("http");
  });

  it("sets verifySsl false when SPLUNK_VERIFY_SSL is 'false'", async () => {
    vi.stubEnv("SPLUNK_VERIFY_SSL", "false");
    vi.resetModules();
    const freshMod = await import("../splunk-client.js");
    const config = freshMod.getSplunkConfig();
    expect(config.verifySsl).toBe(false);
  });

  it("reads username/password when token is not set", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("SPLUNK_HOST", "host.test");
    vi.stubEnv("SPLUNK_USERNAME", "admin");
    vi.stubEnv("SPLUNK_PASSWORD", "pass123");
    vi.resetModules();
    const freshMod = await import("../splunk-client.js");
    const config = freshMod.getSplunkConfig();
    expect(config.username).toBe("admin");
    expect(config.password).toBe("pass123");
    expect(config.token).toBeUndefined();
  });
});

describe("getAuthHeader", () => {
  it("returns Bearer header when token is set", () => {
    const config = mod.getSplunkConfig();
    expect(mod.getAuthHeader(config)).toBe("Bearer test-token-123");
  });

  it("returns Basic header when username/password are set", () => {
    const config = {
      host: "h",
      port: 8089,
      scheme: "https" as const,
      username: "admin",
      password: "secret",
      verifySsl: true,
    };
    const header = mod.getAuthHeader(config);
    expect(header).toMatch(/^Basic /);
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe("admin:secret");
  });

  it("throws when no auth method is configured", () => {
    const config = {
      host: "h",
      port: 8089,
      scheme: "https" as const,
      verifySsl: true,
    };
    expect(() => mod.getAuthHeader(config)).toThrow("SPLUNK_TOKEN or SPLUNK_USERNAME");
  });
});

describe("callSplunkAPI", () => {
  it("sends POST with correct URL, headers, and body", async () => {
    const mockResponse = { ok: true, status: 200, json: async () => ({}) };
    const fetchFn = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal("fetch", fetchFn);

    const config = mod.getSplunkConfig();
    await mod.callSplunkAPI(config, "services/search/jobs", { search: "index=main" });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://splunk.test.com:8089/services/search/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token-123",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      })
    );
  });
});

describe("runSearch", () => {
  function mockSearchFetch(responseBody: string, status = 200) {
    const fn = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => responseBody,
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("returns parsed json_cols response", async () => {
    const response = JSON.stringify({
      fields: [{ name: "host" }, { name: "count" }],
      columns: [
        ["srv1", "srv2"],
        [10, 20],
      ],
    });
    mockSearchFetch(response);

    const config = mod.getSplunkConfig();
    const result = await mod.runSearch(
      config,
      "search index=main | stats count by host",
      "-1h",
      "now"
    );
    expect(result.fields).toEqual([{ name: "host" }, { name: "count" }]);
    expect(result.columns).toEqual([
      ["srv1", "srv2"],
      [10, 20],
    ]);
  });

  it("uses v2/jobs/export for non-generating searches", async () => {
    const response = JSON.stringify({ fields: [], columns: [] });
    const fn = mockSearchFetch(response);

    const config = mod.getSplunkConfig();
    await mod.runSearch(config, "search index=main", "-1h", "now");
    expect(fn).toHaveBeenCalledWith(expect.stringContaining("v2/jobs/export"), expect.any(Object));
  });

  it("uses jobs/oneshot for generating searches (pipe prefix)", async () => {
    const response = JSON.stringify({ fields: [{ name: "x" }], columns: [[1]] });
    const fn = mockSearchFetch(response);

    const config = mod.getSplunkConfig();
    await mod.runSearch(config, "| makeresults count=1", "-1h", "now");
    expect(fn).toHaveBeenCalledWith(expect.stringContaining("jobs/oneshot"), expect.any(Object));
  });

  it("throws on non-ok HTTP response", async () => {
    mockSearchFetch("Splunk error details", 401);

    const config = mod.getSplunkConfig();
    await expect(mod.runSearch(config, "search index=main", "-1h", "now")).rejects.toThrow(
      "Splunk search failed (401)"
    );
  });

  it("throws on Splunk ERROR messages in response", async () => {
    const response = JSON.stringify({
      fields: [],
      columns: [],
      messages: [{ type: "ERROR", text: "Unknown search command 'badcmd'" }],
    });
    mockSearchFetch(response);

    const config = mod.getSplunkConfig();
    await expect(mod.runSearch(config, "search index=main | badcmd", "-1h", "now")).rejects.toThrow(
      "Unknown search command"
    );
  });

  it("normalizes string fields to objects", async () => {
    const response = JSON.stringify({
      fields: ["host", "count"],
      columns: [["a"], [1]],
    });
    mockSearchFetch(response);

    const config = mod.getSplunkConfig();
    const result = await mod.runSearch(
      config,
      "search index=main | stats count by host",
      "-1h",
      "now"
    );
    expect(result.fields).toEqual([{ name: "host" }, { name: "count" }]);
  });

  it("returns empty result for unparseable response", async () => {
    mockSearchFetch("not json at all");

    const config = mod.getSplunkConfig();
    const result = await mod.runSearch(config, "| makeresults", "-1h", "now");
    expect(result.fields).toEqual([]);
    expect(result.columns).toEqual([]);
  });
});
