import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callSplunkAPI } from "./splunk-client.js";
import type {
  SafetyConfig,
  SafeSplJson,
  SafetyCheckResult,
  SplunkConfig,
  SplunkParsedCommand,
  SplunkParserResponse,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadSafetyConfig(maxRowLimit: number): SafetyConfig {
  const raw = readFileSync(join(__dirname, "config", "safe-spl.json"), "utf-8");
  const json = JSON.parse(raw) as SafeSplJson;

  return {
    safeSplCommands: new Set(json.safe_spl_commands.map((c) => c.toLowerCase())),
    subSearchArgCmd: json.sub_search_arg_cmd,
    generatingCommands: new Set(json.generating_commands.map((c) => c.toLowerCase())),
    maxRowLimit,
  };
}

/**
 * Normalize an SPL query: ensure it starts with a proper command prefix
 * and append a `| head` row limit.
 */
export function normalizeSPL(spl: string, config: SafetyConfig): string {
  const trimmed = spl.trim();
  if (!trimmed) return "";

  const headSuffix = ` | head ${config.maxRowLimit + 1}`;

  if (trimmed.toLowerCase().startsWith("search ") || trimmed.startsWith("|")) {
    return trimmed + headSuffix;
  }

  const firstWord = trimmed.split(/\s/, 1)[0].toLowerCase();
  if (config.generatingCommands.has(firstWord)) {
    return `| ${trimmed}${headSuffix}`;
  }

  return `search ${trimmed}${headSuffix}`;
}

function extractBracketSubsearches(value: string): string[] {
  const results: string[] = [];
  let start = 0;
  while (true) {
    const openIdx = value.indexOf("[", start);
    if (openIdx === -1) break;
    const closeIdx = value.indexOf("]", openIdx + 1);
    if (closeIdx === -1) break;
    const inner = value.slice(openIdx + 1, closeIdx).trim();
    if (inner) results.push(inner);
    start = closeIdx + 1;
  }
  return results;
}

function collectSubsearchValues(cmdArgs: unknown, argName: string): string[] {
  const values: string[] = [];

  if (typeof cmdArgs === "object" && cmdArgs !== null && !Array.isArray(cmdArgs)) {
    const dict = cmdArgs as Record<string, unknown>;
    if (argName in dict && typeof dict[argName] === "string") {
      values.push(dict[argName] as string);
    }
  } else if (Array.isArray(cmdArgs)) {
    for (const item of cmdArgs) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const dict = item as Record<string, unknown>;
        if (argName in dict && typeof dict[argName] === "string") {
          values.push(dict[argName] as string);
        }
      } else if (typeof item === "string") {
        values.push(item);
      }
    }
  } else if (typeof cmdArgs === "string") {
    values.push(cmdArgs);
  }

  return values;
}

/**
 * Validate that an SPL query is safe to execute by parsing it with
 * Splunk's /services/search/parser endpoint and checking every command
 * (including recursive subsearches) against the allowlist.
 */
export async function checkSPLSafety(
  splunkConfig: SplunkConfig,
  spl: string,
  safetyConfig: SafetyConfig
): Promise<SafetyCheckResult> {
  try {
    const response = await callSplunkAPI(splunkConfig, "services/search/parser", {
      q: spl,
      expand_macros: "0",
      output_mode: "json",
      parse_only: "1",
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        safe: false,
        message: `Error parsing SPL query (${response.status}): ${body.slice(0, 300)}`,
      };
    }

    const queryTree = (await response.json()) as SplunkParserResponse;
    const commands: SplunkParsedCommand[] = queryTree.commands ?? [];

    for (const cmd of commands) {
      const cmdName = (cmd.command ?? "").trim().toLowerCase();
      if (!cmdName) continue;

      if (!safetyConfig.safeSplCommands.has(cmdName)) {
        return { safe: false, message: `Forbidden command found: ${cmdName}` };
      }

      if (!(cmdName in safetyConfig.subSearchArgCmd)) continue;

      const subsearchArgNames = safetyConfig.subSearchArgCmd[cmdName];
      const cmdArgs = cmd.args;

      for (const argName of subsearchArgNames) {
        if (argName === "args") {
          const rawArgs = cmd.rawargs ?? "";
          if (!rawArgs) continue;

          const matches = rawArgs.match(/\[([^\]]+)\]/g);
          if (!matches) continue;

          for (const match of matches) {
            const subsearch = match.slice(1, -1).trim();
            if (!subsearch) continue;
            const result = await checkSPLSafety(splunkConfig, subsearch, safetyConfig);
            if (!result.safe) {
              return {
                safe: false,
                message: `Unsafe subsearch in ${cmdName}: ${result.message}`,
              };
            }
          }
        } else {
          const values = collectSubsearchValues(cmdArgs, argName);
          for (const value of values) {
            const subsearches = extractBracketSubsearches(value);
            for (const subsearch of subsearches) {
              const result = await checkSPLSafety(splunkConfig, subsearch, safetyConfig);
              if (!result.safe) {
                return {
                  safe: false,
                  message: `Unsafe subsearch in ${cmdName} ${argName}: ${result.message}`,
                };
              }
            }
          }
        }
      }
    }

    return { safe: true, message: "Query is safe to run." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { safe: false, message: `SPL validation error: ${detail}` };
  }
}
