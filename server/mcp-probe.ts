import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerEntry } from "./mcp-config.js";
import { logger } from "./logger.js";

export interface ToolInfo {
  name: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface ProbeResult {
  status: "connected" | "failed";
  serverInfo?: { name: string; version: string };
  tools: ToolInfo[];
  error?: string;
}

const PROBE_TIMEOUT_MS = 15_000;

class ProbeTimeoutError extends Error {
  constructor() {
    super(`Probe timed out after ${PROBE_TIMEOUT_MS / 1000}s`);
    this.name = "ProbeTimeoutError";
  }
}

function forceKillTransport(transport: Transport): void {
  try {
    // StdioClientTransport exposes the child process — kill it directly
    const stdio = transport as unknown as { _process?: { kill: (s: string) => void } };
    if (stdio._process?.kill) {
      stdio._process.kill("SIGKILL");
      return;
    }
  } catch {
    // Not a stdio transport or no process handle
  }
  try {
    transport.close?.();
  } catch {
    // Best-effort
  }
}

export async function probeMcpServer(name: string, config: McpServerEntry): Promise<ProbeResult> {
  const type = config.type ?? "stdio";
  let transport: Transport;

  try {
    if (type === "stdio") {
      const stdio = config as import("./mcp-config.js").StdioServerConfig;
      transport = new StdioClientTransport({
        command: stdio.command,
        args: stdio.args,
        env: stdio.env,
        stderr: "pipe",
      });
    } else if (type === "http") {
      const http = config as import("./mcp-config.js").HttpServerConfig;
      transport = new StreamableHTTPClientTransport(new URL(http.url), {
        requestInit: http.headers ? { headers: http.headers } : undefined,
      });
    } else if (type === "sse") {
      const sse = config as import("./mcp-config.js").SseServerConfig;
      transport = new SSEClientTransport(new URL(sse.url), {
        requestInit: sse.headers ? { headers: sse.headers } : undefined,
      });
    } else {
      return { status: "failed", tools: [], error: `Unknown transport type: ${type}` };
    }
  } catch (err) {
    return {
      status: "failed",
      tools: [],
      error: `Failed to create transport: ${(err as Error).message}`,
    };
  }

  const client = new Client({ name: "opsblaze-probe", version: "1.0.0" }, { capabilities: {} });

  async function probeWork(): Promise<ProbeResult> {
    await client.connect(transport);

    const serverVersion = client.getServerVersion();
    const result = await client.listTools();
    const tools: ToolInfo[] = (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      annotations: t.annotations
        ? {
            readOnlyHint: t.annotations.readOnlyHint,
            destructiveHint: t.annotations.destructiveHint,
            openWorldHint: t.annotations.openWorldHint,
          }
        : undefined,
    }));

    logger.info({ name, toolCount: tools.length }, "MCP server probe succeeded");

    return {
      status: "connected",
      serverInfo: serverVersion
        ? { name: serverVersion.name, version: serverVersion.version }
        : undefined,
      tools,
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      probeWork(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeoutError()), PROBE_TIMEOUT_MS);
      }),
    ]);
    return result;
  } catch (err) {
    if (err instanceof ProbeTimeoutError) {
      logger.warn({ name }, "MCP server probe timed out — killing transport");
      forceKillTransport(transport);
    }
    const message = (err as Error).message ?? String(err);
    logger.warn({ name, err: message }, "MCP server probe failed");
    return { status: "failed", tools: [], error: message };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try {
      await client.close();
    } catch {
      // Best-effort cleanup
    }
  }
}
