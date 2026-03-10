import type { SplunkConfig, SplunkJsonColsResponse } from "./types.js";

let insecureAgent: unknown;

async function scopedFetch(
  url: string,
  options: RequestInit,
  skipTlsVerify: boolean
): Promise<Response> {
  if (!skipTlsVerify) return fetch(url, options);

  if (!insecureAgent) {
    const { Agent } = await import("undici");
    insecureAgent = new Agent({
      connect: { rejectUnauthorized: false },
    });
  }
  // @ts-expect-error -- dispatcher is a Node.js-specific fetch extension
  return fetch(url, { ...options, dispatcher: insecureAgent });
}

export function getSplunkConfig(): SplunkConfig {
  const host = process.env.SPLUNK_HOST;
  if (!host) {
    throw new Error("SPLUNK_HOST environment variable is required");
  }

  return {
    host,
    port: parseInt(process.env.SPLUNK_PORT ?? "8089", 10),
    scheme: (process.env.SPLUNK_SCHEME as "http" | "https") ?? "https",
    token: process.env.SPLUNK_TOKEN,
    username: process.env.SPLUNK_USERNAME,
    password: process.env.SPLUNK_PASSWORD,
    verifySsl: process.env.SPLUNK_VERIFY_SSL !== "false",
  };
}

export function getAuthHeader(config: SplunkConfig): string {
  if (config.token) {
    return `Bearer ${config.token}`;
  }
  if (config.username && config.password) {
    const encoded = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    return `Basic ${encoded}`;
  }
  throw new Error("Either SPLUNK_TOKEN or SPLUNK_USERNAME + SPLUNK_PASSWORD must be set");
}

/**
 * Generic authenticated POST to any Splunk REST endpoint.
 * Used by both runSearch() and the SPL safety validator.
 */
export async function callSplunkAPI(
  config: SplunkConfig,
  endpoint: string,
  body: Record<string, string>
): Promise<Response> {
  const baseUrl = `${config.scheme}://${config.host}:${config.port}`;
  const url = `${baseUrl}/${endpoint}`;
  return scopedFetch(
    url,
    {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(config),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    },
    !config.verifySsl
  );
}

function parseLastJsonColsResult(raw: string): SplunkJsonColsResponse | null {
  const trimmed = raw.trim();

  try {
    const single = JSON.parse(trimmed) as SplunkJsonColsResponse;
    if (single.fields && single.columns) return single;
  } catch {
    // Not a single object — continue to split
  }

  const candidates: string[] = [];
  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length > 1) {
    candidates.push(...lines);
  } else {
    const parts = trimmed.split(/\}\s*\{/);
    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];
      if (i > 0) part = "{" + part;
      if (i < parts.length - 1) part = part + "}";
      candidates.push(part);
    }
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]) as SplunkJsonColsResponse;
      if (parsed.fields && parsed.columns) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeFields(fields: Array<string | { name: string }>): Array<{ name: string }> {
  return fields.map((f) => (typeof f === "string" ? { name: f } : f));
}

export async function runSearch(
  config: SplunkConfig,
  spl: string,
  earliest: string,
  latest: string,
  maxRowLimit: number = 10000
): Promise<SplunkJsonColsResponse> {
  const baseUrl = `${config.scheme}://${config.host}:${config.port}`;

  const isGenerating = spl.trimStart().startsWith("|");
  const url = isGenerating
    ? `${baseUrl}/services/search/jobs/oneshot`
    : `${baseUrl}/services/search/v2/jobs/export`;

  const params = new URLSearchParams({
    search: spl,
    earliest_time: earliest,
    latest_time: latest,
    output_mode: "json_cols",
    count: String(maxRowLimit + 1),
  });

  const timeoutMs = parseInt(process.env.SPLUNK_TIMEOUT_MS ?? "60000", 10);

  const fetchOptions: RequestInit = {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(config),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(timeoutMs),
  };

  const response = await scopedFetch(url, fetchOptions, !config.verifySsl);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Splunk search failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const rawText = await response.text();
  let data: SplunkJsonColsResponse;
  if (isGenerating) {
    try {
      data = JSON.parse(rawText) as SplunkJsonColsResponse;
    } catch {
      data = { fields: [], columns: [] };
    }
  } else {
    data = parseLastJsonColsResult(rawText) ?? { fields: [], columns: [] };
  }

  if (data.messages) {
    const errors = data.messages.filter((m) => m.type === "ERROR" || m.type === "FATAL");
    if (errors.length > 0) {
      throw new Error(`Splunk search error: ${errors.map((e) => e.text).join("; ")}`);
    }
  }

  if (!data.fields || !Array.isArray(data.fields)) {
    data.fields = [];
  }
  if (!data.columns || !Array.isArray(data.columns)) {
    data.columns = [];
  }

  if (data.fields.length > 0) {
    data.fields = normalizeFields(data.fields as Array<string | { name: string }>);
  }

  return data;
}
