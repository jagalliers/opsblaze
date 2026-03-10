import type { SplunkJsonColsResponse, SplunkDataSources } from "./types.js";

const STRIP_FIELDS = new Set([
  "_si",
  "_serial",
  "_sourcetype",
  "_subsecond",
  "_indextime",
  "_cd",
  "_bkt",
  "_kv",
  "_pre_msg",
  "_raw",
]);

function isNumericColumn(column: unknown[]): boolean {
  let numericCount = 0;
  let totalCount = 0;

  for (const val of column) {
    if (val === null || val === undefined || val === "") continue;
    totalCount++;
    if (typeof val === "number") {
      numericCount++;
    } else if (typeof val === "string" && !isNaN(Number(val)) && val.trim() !== "") {
      numericCount++;
    }
  }

  if (totalCount === 0) return false;
  return numericCount / totalCount > 0.8;
}

function castNumericColumn(column: unknown[]): unknown[] {
  return column.map((val) => {
    if (val === null || val === undefined || val === "") return val;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const num = Number(val);
      return isNaN(num) ? val : num;
    }
    return val;
  });
}

export function transformToDataSources(
  response: SplunkJsonColsResponse,
  keepAllFields: boolean = false
): SplunkDataSources {
  const { fields, columns } = response;

  const indices: number[] = [];
  const filteredFields: Array<{ name: string }> = [];

  for (let i = 0; i < fields.length; i++) {
    const fieldName = fields[i].name;
    if (keepAllFields || !STRIP_FIELDS.has(fieldName)) {
      indices.push(i);
      filteredFields.push(fields[i]);
    }
  }

  const filteredColumns: unknown[][] = indices.map((idx) => {
    const col = columns[idx];
    if (isNumericColumn(col)) {
      return castNumericColumn(col);
    }
    return col.map((v) => (v === null || v === undefined ? "" : String(v)));
  });

  return {
    primary: {
      data: {
        fields: filteredFields,
        columns: filteredColumns,
      },
    },
  };
}

export function summarizeResults(response: SplunkJsonColsResponse, maxRows: number = 20): string {
  const { fields, columns } = response;
  if (!fields.length || !columns.length) return "No results returned.";

  const rowCount = columns[0]?.length ?? 0;
  const fieldNames = fields.map((f) => f.name);
  const displayRows = Math.min(rowCount, maxRows);

  let summary = `${rowCount} row(s), ${fields.length} field(s): ${fieldNames.join(", ")}\n`;

  for (let r = 0; r < displayRows; r++) {
    const row = fieldNames.map((name, i) => `${name}=${columns[i]?.[r] ?? "null"}`).join(", ");
    summary += `  ${row}\n`;
  }

  if (rowCount > maxRows) {
    summary += `  ... (${rowCount - maxRows} more rows)\n`;
  }

  return summary;
}
