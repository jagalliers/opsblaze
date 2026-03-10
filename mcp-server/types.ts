export const VIZ_TYPES = ["line", "area", "bar", "column", "pie", "singlevalue", "table"] as const;

export type VizType = (typeof VIZ_TYPES)[number];

export interface SplunkDataSources {
  primary: {
    data: {
      fields: Array<{ name: string }>;
      columns: unknown[][];
    };
  };
}

export interface SplunkJsonColsResponse {
  fields: Array<{ name: string }>;
  columns: unknown[][];
  init_offset?: number;
  messages?: Array<{ type: string; text: string }>;
}

export interface SplunkConfig {
  host: string;
  port: number;
  scheme: "http" | "https";
  token?: string;
  username?: string;
  password?: string;
  verifySsl: boolean;
}

/**
 * Structured result returned by the splunk_query MCP tool.
 * The orchestrating server parses this to route chart data to the browser
 * and text summaries to the model.
 */
export interface SplunkToolResult {
  summary: string;
  chart: {
    vizType: VizType;
    dataSources: SplunkDataSources;
    width: number;
    height: number;
  } | null;
  suppressed: boolean;
  queryMeta?: { spl: string; earliest: string; latest: string };
}

// --- SPL Safety Types ---

export interface SafetyConfig {
  safeSplCommands: Set<string>;
  subSearchArgCmd: Record<string, string[]>;
  generatingCommands: Set<string>;
  maxRowLimit: number;
}

export interface SafeSplJson {
  safe_spl_commands: string[];
  sub_search_arg_cmd: Record<string, string[]>;
  generating_commands: string[];
}

export interface SplunkParsedCommand {
  command: string;
  rawargs?: string;
  args?: Record<string, unknown> | unknown[] | string;
}

export interface SplunkParserResponse {
  commands: SplunkParsedCommand[];
}

export interface SafetyCheckResult {
  safe: boolean;
  message: string;
}
