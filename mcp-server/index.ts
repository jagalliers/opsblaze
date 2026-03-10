#!/usr/bin/env node

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getSplunkConfig, runSearch } from "./splunk-client.js";
import { transformToDataSources, summarizeResults } from "./transform.js";
import { loadSafetyConfig, normalizeSPL, checkSPLSafety } from "./spl-safety.js";
import type { VizType, SplunkToolResult } from "./types.js";
import { log } from "./logger.js";

const server = new McpServer({
  name: "opsblaze-splunk",
  version: "0.1.0",
});

const mcpEnv = z
  .object({
    MAX_ROW_LIMIT: z.coerce.number().int().positive().default(10000),
    SPL_SAFETY_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
  })
  .parse(process.env);

const MAX_ROW_LIMIT = mcpEnv.MAX_ROW_LIMIT;
const SPL_SAFETY_ENABLED = mcpEnv.SPL_SAFETY_ENABLED;
const safetyConfig = loadSafetyConfig(MAX_ROW_LIMIT);

const DIAGNOSTIC_FIELDS = new Set([
  "earliest_epoch",
  "latest_epoch",
  "earliest",
  "latest",
  "total_events",
  "total_audit_events",
]);

function isAllZeroRow(columns: unknown[][]): boolean {
  if (columns.length === 0 || columns[0].length !== 1) return false;
  return columns.every((col) => {
    const v = col[0];
    return v === 0 || v === "0" || v === null || v === undefined || v === "";
  });
}

function shouldSuppressChart(
  spl: string,
  fields: Array<{ name: string }>,
  columns: unknown[][]
): boolean {
  const normalized = fields.map((f) => f.name.toLowerCase());
  const allDiagnostic = normalized.every((name) => DIAGNOSTIC_FIELDS.has(name));
  const hasMinMaxTimePattern = spl.includes("min(_time)") && spl.includes("max(_time)");
  return allDiagnostic || hasMinMaxTimePattern || isAllZeroRow(columns);
}

server.tool(
  "splunk_query",
  "Execute an SPL query against Splunk and return structured results with " +
    "visualization data. Returns a JSON object containing a text summary for " +
    "analysis and dataSources for rendering interactive charts in the browser.",
  {
    spl: z
      .string()
      .describe(
        'The SPL query to execute. Examples: "index=main | timechart count by sourcetype", ' +
          '"| tstats count where index=* by index"'
      ),
    viz_type: z
      .enum(["line", "area", "bar", "column", "pie", "singlevalue", "table"])
      .describe(
        "The visualization type. line/area for time series, bar/column for categorical, " +
          "pie for composition, singlevalue for KPIs, table for detail."
      ),
    earliest: z
      .string()
      .default("-24h")
      .describe(
        "Earliest time. MUST use Splunk relative time notation or epoch seconds. " +
          'Valid: "-1h", "-24h@h", "-30d@d", "0" (all time), "1534723200" (epoch). ' +
          "Do NOT use ISO timestamps."
      ),
    latest: z
      .string()
      .default("now")
      .describe(
        "Latest time. MUST use Splunk relative time notation or epoch seconds. " +
          'Valid: "now", "-5m", "+0s", "1534809600" (epoch). Do NOT use ISO timestamps.'
      ),
    width: z.number().int().default(1100).describe("Width of the visualization in pixels."),
    height: z.number().int().default(500).describe("Height of the visualization in pixels."),
  },
  async (params) => {
    try {
      const config = getSplunkConfig();
      const normalizedSpl = normalizeSPL(params.spl, safetyConfig);

      if (SPL_SAFETY_ENABLED) {
        const check = await checkSPLSafety(config, normalizedSpl, safetyConfig);
        if (!check.safe) {
          log.warn(`SPL rejected: ${check.message}`);
          const rejected: SplunkToolResult = {
            summary: `SPL rejected by safety filter: ${check.message}`,
            chart: null,
            suppressed: true,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(rejected) }],
          };
        }
      }

      log.debug(
        `Running SPL: ${normalizedSpl.slice(0, 120)}... ` +
          `(${params.earliest} to ${params.latest})`
      );

      const results = await runSearch(
        config,
        normalizedSpl,
        params.earliest,
        params.latest,
        MAX_ROW_LIMIT
      );

      const rowCount = results.columns?.[0]?.length ?? 0;
      log.debug(`Search returned ${rowCount} rows, ${results.fields?.length ?? 0} fields`);

      if (!results.fields?.length || rowCount === 0) {
        const noResults: SplunkToolResult = {
          summary: "No results returned for this query in the requested time range.",
          chart: null,
          suppressed: true,
          queryMeta: { spl: normalizedSpl, earliest: params.earliest, latest: params.latest },
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(noResults) }],
        };
      }

      const keepAllFields = params.viz_type === "table";
      const dataSources = transformToDataSources(results, keepAllFields);
      const suppressed = shouldSuppressChart(normalizedSpl, results.fields, results.columns);

      const result: SplunkToolResult = {
        summary: summarizeResults(results),
        chart: suppressed
          ? null
          : {
              vizType: params.viz_type as VizType,
              dataSources,
              width: params.width,
              height: params.height,
            },
        suppressed,
        queryMeta: { spl: normalizedSpl, earliest: params.earliest, latest: params.latest },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      const MAX_ERROR_LEN = 500;
      const raw = error instanceof Error ? error.message : String(error);
      log.error(`Error: ${raw}`);
      const truncated =
        raw.length > MAX_ERROR_LEN
          ? raw.slice(0, MAX_ERROR_LEN) + " ... [truncated — full error logged server-side]"
          : raw;
      return {
        content: [
          {
            type: "text" as const,
            text: `Error executing SPL query: ${truncated}`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  log.info("Starting OpsBlaze Splunk MCP Server");
  log.info(`Splunk host: ${process.env.SPLUNK_HOST ?? "(not set)"}`);
  log.info(
    `SPL safety: ${SPL_SAFETY_ENABLED ? "enabled" : "disabled"}, ` +
      `max rows: ${MAX_ROW_LIMIT}, allowlist: ${safetyConfig.safeSplCommands.size} commands`
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info("MCP server connected via stdio");

  process.on("SIGINT", () => {
    log.info("Shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("Shutting down...");
    process.exit(0);
  });
}

main().catch((err) => {
  log.fatal(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
