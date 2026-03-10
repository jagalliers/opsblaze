import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadSafetyConfig, normalizeSPL, checkSPLSafety } from "../spl-safety.js";
import type { SplunkConfig, SplunkParsedCommand } from "../types.js";

const mockCallSplunkAPI = vi.fn();
vi.mock("../splunk-client.js", () => ({
  callSplunkAPI: (...args: unknown[]) => mockCallSplunkAPI(...args),
  getSplunkConfig: () => ({}),
  getAuthHeader: () => "",
  runSearch: vi.fn(),
}));

const dummySplunkConfig: SplunkConfig = {
  host: "localhost",
  port: 8089,
  scheme: "https",
  token: "fake-token",
  verifySsl: false,
};

function fakeParserResponse(commands: SplunkParsedCommand[]): Response {
  return new Response(JSON.stringify({ commands }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeErrorResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

// ---------------------------------------------------------------------------
// loadSafetyConfig
// ---------------------------------------------------------------------------
describe("loadSafetyConfig", () => {
  const config = loadSafetyConfig(1000);

  it("loads exactly 141 safe SPL commands (matching Splunk MCP server)", () => {
    expect(config.safeSplCommands.size).toBe(141);
  });

  it("stores all commands as lowercase", () => {
    for (const cmd of config.safeSplCommands) {
      expect(cmd).toBe(cmd.toLowerCase());
    }
  });

  it("includes expected whitelisted commands", () => {
    for (const cmd of ["search", "stats", "eval", "table", "timechart", "head", "tstats", "join"]) {
      expect(config.safeSplCommands.has(cmd)).toBe(true);
    }
  });

  it("does NOT include dangerous commands", () => {
    for (const cmd of [
      "delete",
      "sendemail",
      "script",
      "outputlookup",
      "collect",
      "rest",
      "savedsearch",
      "history",
    ]) {
      expect(config.safeSplCommands.has(cmd)).toBe(false);
    }
  });

  it("loads generating commands", () => {
    for (const cmd of ["tstats", "makeresults", "datamodel", "metadata", "search"]) {
      expect(config.generatingCommands.has(cmd)).toBe(true);
    }
  });

  it("loads sub_search_arg_cmd mappings", () => {
    expect(config.subSearchArgCmd["join"]).toEqual(["args"]);
    expect(config.subSearchArgCmd["append"]).toEqual(["args"]);
    expect(config.subSearchArgCmd["map"]).toEqual(["search"]);
  });

  it("stores the provided maxRowLimit", () => {
    expect(config.maxRowLimit).toBe(1000);
    const custom = loadSafetyConfig(500);
    expect(custom.maxRowLimit).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// normalizeSPL
// ---------------------------------------------------------------------------
describe("normalizeSPL", () => {
  const config = loadSafetyConfig(1000);

  it("returns empty string for empty input", () => {
    expect(normalizeSPL("", config)).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeSPL("   ", config)).toBe("");
  });

  it("prepends 'search' for bare index queries", () => {
    expect(normalizeSPL("index=main", config)).toBe("search index=main | head 1001");
  });

  it("preserves existing 'search' prefix", () => {
    expect(normalizeSPL("search index=main", config)).toBe("search index=main | head 1001");
  });

  it("detects 'search' prefix case-insensitively", () => {
    expect(normalizeSPL("SEARCH index=main", config)).toBe("SEARCH index=main | head 1001");
  });

  it("preserves queries that start with pipe", () => {
    expect(normalizeSPL("| tstats count where index=main", config)).toBe(
      "| tstats count where index=main | head 1001"
    );
  });

  it("prepends '| ' for bare generating commands", () => {
    expect(normalizeSPL("tstats count where index=main", config)).toBe(
      "| tstats count where index=main | head 1001"
    );
  });

  it("prepends '| ' for makeresults", () => {
    expect(normalizeSPL("makeresults count=5", config)).toBe("| makeresults count=5 | head 1001");
  });

  it("prepends '| ' for datamodel with pipeline", () => {
    expect(normalizeSPL("datamodel mymodel | stats count", config)).toBe(
      "| datamodel mymodel | stats count | head 1001"
    );
  });

  it("prepends 'search' and appends head for multi-pipe queries", () => {
    expect(normalizeSPL("index=main | stats count by src", config)).toBe(
      "search index=main | stats count by src | head 1001"
    );
  });

  it("preserves pipe-prefixed generating commands with pipeline", () => {
    expect(normalizeSPL("| makeresults | eval x=1", config)).toBe(
      "| makeresults | eval x=1 | head 1001"
    );
  });

  it("respects custom maxRowLimit", () => {
    const cfg500 = loadSafetyConfig(500);
    expect(normalizeSPL("index=main", cfg500)).toBe("search index=main | head 501");
  });

  it("handles maxRowLimit of 0", () => {
    const cfg0 = loadSafetyConfig(0);
    expect(normalizeSPL("index=main", cfg0)).toBe("search index=main | head 1");
  });

  it("strips leading/trailing whitespace from input", () => {
    expect(normalizeSPL("  index=main  ", config)).toBe("search index=main | head 1001");
  });
});

// ---------------------------------------------------------------------------
// checkSPLSafety
// ---------------------------------------------------------------------------
describe("checkSPLSafety", () => {
  const config = loadSafetyConfig(1000);

  beforeEach(() => {
    mockCallSplunkAPI.mockReset();
  });

  it("passes a query with all-whitelist commands", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "stats", rawargs: "count by sourcetype" },
        { command: "head", rawargs: "1001" },
      ])
    );

    const result = await checkSPLSafety(
      dummySplunkConfig,
      "search index=main | stats count by sourcetype | head 1001",
      config
    );
    expect(result.safe).toBe(true);
    expect(result.message).toContain("safe");
  });

  it("passes a query with empty commands list", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(fakeParserResponse([]));

    const result = await checkSPLSafety(dummySplunkConfig, "| noop", config);
    expect(result.safe).toBe(true);
  });

  it("handles command names case-insensitively", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "SEARCH", rawargs: "index=main" },
        { command: "Stats", rawargs: "count" },
      ])
    );

    const result = await checkSPLSafety(
      dummySplunkConfig,
      "SEARCH index=main | Stats count",
      config
    );
    expect(result.safe).toBe(true);
  });

  it("rejects 'delete' command", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([{ command: "search", rawargs: "index=main" }, { command: "delete" }])
    );

    const result = await checkSPLSafety(dummySplunkConfig, "search index=main | delete", config);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("delete");
  });

  it("rejects 'sendemail' command", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "sendemail", rawargs: 'to="admin@example.com"' },
      ])
    );

    const result = await checkSPLSafety(dummySplunkConfig, "dummy", config);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("sendemail");
  });

  it("rejects 'script' command", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "script", rawargs: "python my_script.py" },
      ])
    );

    const result = await checkSPLSafety(dummySplunkConfig, "dummy", config);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("script");
  });

  it("rejects 'rest' command", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([{ command: "rest", rawargs: "/services/server/info" }])
    );

    const result = await checkSPLSafety(dummySplunkConfig, "dummy", config);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("rest");
  });

  it("rejects 'outputlookup' command", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "stats", rawargs: "count" },
        { command: "outputlookup", rawargs: "my_lookup.csv" },
      ])
    );

    const result = await checkSPLSafety(dummySplunkConfig, "dummy", config);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("outputlookup");
  });

  it("catches forbidden command inside a join subsearch", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "join", rawargs: "[search index=main | delete]" },
        { command: "head", rawargs: "1001" },
      ])
    );
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([{ command: "search", rawargs: "index=main" }, { command: "delete" }])
    );

    const result = await checkSPLSafety(
      dummySplunkConfig,
      "search index=main | join [search index=main | delete] | head 1001",
      config
    );
    expect(result.safe).toBe(false);
    expect(result.message).toContain("Unsafe subsearch in join");
    expect(result.message).toContain("delete");
  });

  it("passes a safe join subsearch", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "join", rawargs: "[search index=main | stats count]" },
        { command: "head", rawargs: "1001" },
      ])
    );
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "stats", rawargs: "count" },
      ])
    );

    const result = await checkSPLSafety(
      dummySplunkConfig,
      "search index=main | join [search index=main | stats count] | head 1001",
      config
    );
    expect(result.safe).toBe(true);
  });

  it("catches forbidden command inside an append subsearch", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "append", rawargs: "[search index=main | outputlookup evil.csv]" },
      ])
    );
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "search", rawargs: "index=main" },
        { command: "outputlookup", rawargs: "evil.csv" },
      ])
    );

    const result = await checkSPLSafety(dummySplunkConfig, "dummy", config);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("Unsafe subsearch in append");
    expect(result.message).toContain("outputlookup");
  });

  it("returns safe:false when parser API returns HTTP error", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(fakeErrorResponse(400, "Invalid SPL syntax"));

    const result = await checkSPLSafety(dummySplunkConfig, "bad query ///", config);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("400");
  });

  it("returns safe:false when callSplunkAPI throws a network error", async () => {
    mockCallSplunkAPI.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await checkSPLSafety(dummySplunkConfig, "search index=main", config);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("skips commands with empty command name", async () => {
    mockCallSplunkAPI.mockResolvedValueOnce(
      fakeParserResponse([
        { command: "", rawargs: "" },
        { command: "search", rawargs: "index=main" },
      ])
    );

    const result = await checkSPLSafety(dummySplunkConfig, "dummy", config);
    expect(result.safe).toBe(true);
  });
});
