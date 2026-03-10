import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { logger } from "./logger.js";

export interface StdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface HttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface SseServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export type McpServerEntry = StdioServerConfig | HttpServerConfig | SseServerConfig;

export interface McpServersFile {
  servers: Record<string, McpServerEntry>;
}

export interface McpServerInfo {
  name: string;
  config: McpServerEntry;
  builtIn: boolean;
}

const DATA_ROOT = path.resolve(
  process.env.OPSBLAZE_DATA_DIR ? path.dirname(process.env.OPSBLAZE_DATA_DIR) : "./data"
);
const CONFIG_PATH = path.join(DATA_ROOT, "mcp-servers.json");
export const MCP_CONFIG_PATH = CONFIG_PATH;

async function ensureDir() {
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
}

async function readConfig(): Promise<McpServersFile> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as McpServersFile;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { servers: {} };
    logger.error({ err }, "failed to read MCP servers config");
    return { servers: {} };
  }
}

async function writeConfig(config: McpServersFile): Promise<void> {
  await ensureDir();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function getBuiltInSplunkServer(): McpServerEntry {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("SPLUNK_") && value !== undefined) {
      env[key] = value;
    }
  }
  if (process.env.LOG_LEVEL) {
    env.LOG_LEVEL = process.env.LOG_LEVEL;
  }
  const mcpServerPath = path.join(process.cwd(), "mcp-server", "index.ts");
  return {
    type: "stdio",
    command: "npx",
    args: ["tsx", mcpServerPath],
    env,
    enabled: true,
  };
}

function redactEnv(entry: McpServerEntry): McpServerEntry {
  if (!("env" in entry) || !entry.env) return entry;
  const redacted: Record<string, string> = {};
  for (const key of Object.keys(entry.env)) {
    redacted[key] = "••••••";
  }
  return { ...entry, env: redacted };
}

function redactHeaders(entry: McpServerEntry): McpServerEntry {
  if (!("headers" in entry) || !entry.headers) return entry;
  const redacted: Record<string, string> = {};
  for (const key of Object.keys(entry.headers)) {
    redacted[key] = "••••••";
  }
  return { ...entry, headers: redacted };
}

function redactSecrets(entry: McpServerEntry): McpServerEntry {
  return redactHeaders(redactEnv(entry));
}

export async function listMcpServers(): Promise<McpServerInfo[]> {
  const config = await readConfig();
  const servers: McpServerInfo[] = [];

  servers.push({
    name: "opsblaze-splunk",
    config: redactSecrets(getBuiltInSplunkServer()),
    builtIn: true,
  });

  for (const [name, entry] of Object.entries(config.servers)) {
    servers.push({ name, config: redactSecrets(entry), builtIn: false });
  }

  return servers;
}

export async function getMcpServer(name: string): Promise<McpServerInfo | null> {
  if (name === "opsblaze-splunk") {
    return { name, config: getBuiltInSplunkServer(), builtIn: true };
  }
  const config = await readConfig();
  const entry = config.servers[name];
  if (!entry) return null;
  return { name, config: entry, builtIn: false };
}

const ALLOWED_STDIO_COMMANDS = new Set([
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
]);

const BLOCKED_ENV_KEYS = new Set([
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "PYTHONSTARTUP",
  "PYTHONPATH",
  "RUBYOPT",
  "PERL5OPT",
  "BASH_ENV",
  "ENV",
]);

const BLOCKED_ARG_PATTERNS = [
  /^--require$/,
  /^--require=.+/,
  /^-r$/,
  /^--eval$/,
  /^--eval=.+/,
  /^-e$/,
  /^--import$/,
  /^--import=.+/,
  /^--loader$/,
  /^--loader=.+/,
  /^-c$/, // python -c
  /^--experimental-loader$/,
  /^--experimental-loader=.+/,
];

function validateMcpServerEntry(entry: McpServerEntry): void {
  const type = entry.type ?? "stdio";

  if (type === "stdio") {
    const stdio = entry as StdioServerConfig;
    if (!stdio.command || typeof stdio.command !== "string") {
      throw new Error("stdio server requires a command");
    }
    const base = stdio.command.split("/").pop() ?? stdio.command;
    if (!ALLOWED_STDIO_COMMANDS.has(base)) {
      throw new Error(
        `Command '${base}' is not allowed. Permitted: ${[...ALLOWED_STDIO_COMMANDS].join(", ")}`
      );
    }
    if (stdio.args && !Array.isArray(stdio.args)) {
      throw new Error("args must be an array of strings");
    }
    if (stdio.args?.some((a) => typeof a !== "string")) {
      throw new Error("args must be an array of strings");
    }
    if (stdio.args) {
      for (const arg of stdio.args) {
        if (BLOCKED_ARG_PATTERNS.some((p) => p.test(arg))) {
          throw new Error(`Argument '${arg}' is not allowed for security reasons`);
        }
      }
    }
    if (stdio.env && (typeof stdio.env !== "object" || Array.isArray(stdio.env))) {
      throw new Error("env must be an object of string key-value pairs");
    }
    if (stdio.env) {
      for (const key of Object.keys(stdio.env)) {
        if (BLOCKED_ENV_KEYS.has(key)) {
          throw new Error(`Environment variable '${key}' is blocked for security reasons`);
        }
      }
    }
  } else if (type === "http" || type === "sse") {
    const remote = entry as HttpServerConfig | SseServerConfig;
    if (!remote.url || typeof remote.url !== "string") {
      throw new Error(`${type} server requires a url`);
    }
    try {
      const parsed = new URL(remote.url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("url must use http or https protocol");
      }
    } catch (e) {
      if ((e as Error).message.includes("protocol")) throw e;
      throw new Error("url must be a valid URL");
    }
  } else {
    throw new Error(`Unknown server type: ${type}`);
  }
}

export async function addMcpServer(name: string, entry: McpServerEntry): Promise<void> {
  if (name === "opsblaze-splunk") {
    throw new Error("Cannot modify built-in server");
  }
  validateMcpServerEntry(entry);
  const config = await readConfig();
  if (config.servers[name]) {
    throw new Error(`Server '${name}' already exists`);
  }
  config.servers[name] = entry;
  await writeConfig(config);
  logger.info({ name, type: entry.type ?? "stdio" }, "MCP server added");
}

const REDACT_SENTINEL = "••••••";

function mergeRedactedRecord(
  incoming: Record<string, string> | undefined,
  existing: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!incoming) return undefined;
  if (!existing) return incoming;
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    merged[key] = value === REDACT_SENTINEL && key in existing ? existing[key] : value;
  }
  return merged;
}

function mergeRedactedEntry(incoming: McpServerEntry, existing: McpServerEntry): McpServerEntry {
  const result = { ...incoming };
  if ("env" in result && "env" in existing) {
    (result as StdioServerConfig).env = mergeRedactedRecord(
      (result as StdioServerConfig).env,
      (existing as StdioServerConfig).env
    );
  }
  if ("headers" in result && "headers" in existing) {
    (result as HttpServerConfig | SseServerConfig).headers = mergeRedactedRecord(
      (result as HttpServerConfig | SseServerConfig).headers,
      (existing as HttpServerConfig | SseServerConfig).headers
    );
  }
  return result;
}

export async function updateMcpServer(name: string, entry: McpServerEntry): Promise<void> {
  if (name === "opsblaze-splunk") {
    throw new Error("Cannot modify built-in server");
  }
  validateMcpServerEntry(entry);
  const config = await readConfig();
  const existing = config.servers[name];
  if (!existing) {
    throw new Error(`Server '${name}' not found`);
  }
  config.servers[name] = mergeRedactedEntry(entry, existing);
  await writeConfig(config);
  logger.info({ name }, "MCP server updated");
}

export async function deleteMcpServer(name: string): Promise<void> {
  if (name === "opsblaze-splunk") {
    throw new Error("Cannot delete built-in server");
  }
  const config = await readConfig();
  if (!config.servers[name]) {
    throw new Error(`Server '${name}' not found`);
  }
  delete config.servers[name];
  await writeConfig(config);
  logger.info({ name }, "MCP server deleted");
}

export async function toggleMcpServer(name: string, enabled: boolean): Promise<void> {
  if (name === "opsblaze-splunk") {
    throw new Error("Cannot toggle built-in server");
  }
  const config = await readConfig();
  const entry = config.servers[name];
  if (!entry) {
    throw new Error(`Server '${name}' not found`);
  }
  entry.enabled = enabled;
  await writeConfig(config);
  logger.info({ name, enabled }, "MCP server toggled");
}

/**
 * Returns all servers with unredacted credentials (for internal use only).
 */
async function listMcpServersRaw(): Promise<McpServerInfo[]> {
  const config = await readConfig();
  const servers: McpServerInfo[] = [];

  servers.push({
    name: "opsblaze-splunk",
    config: getBuiltInSplunkServer(),
    builtIn: true,
  });

  for (const [name, entry] of Object.entries(config.servers)) {
    servers.push({ name, config: entry, builtIn: false });
  }

  return servers;
}

/**
 * Merges built-in + enabled user servers into the shape the Agent SDK query() expects.
 * Uses unredacted configs so the SDK gets real credentials.
 */
export async function buildMcpServersForQuery(): Promise<{
  mcpServers: Record<string, any>;
  allowedTools: string[];
}> {
  const allServers = await listMcpServersRaw();
  const mcpServers: Record<string, any> = {};
  const allowedTools: string[] = ["Skill"];

  for (const { name, config } of allServers) {
    if (!config.enabled) continue;

    const type = config.type ?? "stdio";
    allowedTools.push(`mcp__${name}__*`);

    if (type === "stdio") {
      const stdio = config as StdioServerConfig;
      mcpServers[name] = {
        command: stdio.command,
        args: stdio.args,
        env: stdio.env,
      };
    } else if (type === "http") {
      const http = config as HttpServerConfig;
      mcpServers[name] = {
        type: "http",
        url: http.url,
        headers: http.headers,
      };
    } else if (type === "sse") {
      const sse = config as SseServerConfig;
      mcpServers[name] = {
        type: "sse",
        url: sse.url,
        headers: sse.headers,
      };
    }
  }

  return { mcpServers, allowedTools };
}
