import { describe, it, expect } from "vitest";
import { transformToDataSources, summarizeResults } from "../transform.js";
import type { SplunkJsonColsResponse } from "../types.js";

describe("transformToDataSources", () => {
  it("transforms a basic response into dataSources format", () => {
    const input: SplunkJsonColsResponse = {
      fields: [{ name: "host" }, { name: "count" }],
      columns: [
        ["server1", "server2"],
        ["10", "20"],
      ],
    };

    const result = transformToDataSources(input);
    expect(result.primary.data.fields).toEqual([{ name: "host" }, { name: "count" }]);
    expect(result.primary.data.columns).toEqual([
      ["server1", "server2"],
      [10, 20],
    ]);
  });

  it("strips internal Splunk fields by default", () => {
    const input: SplunkJsonColsResponse = {
      fields: [{ name: "host" }, { name: "_si" }, { name: "_raw" }, { name: "count" }],
      columns: [["s1"], ["idx"], ["raw data"], ["5"]],
    };

    const result = transformToDataSources(input);
    expect(result.primary.data.fields.map((f) => f.name)).toEqual(["host", "count"]);
    expect(result.primary.data.columns.length).toBe(2);
  });

  it("keeps all fields when keepAllFields is true", () => {
    const input: SplunkJsonColsResponse = {
      fields: [{ name: "host" }, { name: "_raw" }],
      columns: [["s1"], ["raw data"]],
    };

    const result = transformToDataSources(input, true);
    expect(result.primary.data.fields.map((f) => f.name)).toEqual(["host", "_raw"]);
  });

  it("casts numeric columns to numbers", () => {
    const input: SplunkJsonColsResponse = {
      fields: [{ name: "count" }],
      columns: [["100", "200", "0", "3.14"]],
    };

    const result = transformToDataSources(input);
    expect(result.primary.data.columns[0]).toEqual([100, 200, 0, 3.14]);
  });

  it("leaves mixed columns as strings", () => {
    const input: SplunkJsonColsResponse = {
      fields: [{ name: "value" }],
      columns: [["abc", "def", "ghi", "jkl", "mno"]],
    };

    const result = transformToDataSources(input);
    expect(result.primary.data.columns[0]).toEqual(["abc", "def", "ghi", "jkl", "mno"]);
  });

  it("handles empty response", () => {
    const input: SplunkJsonColsResponse = {
      fields: [],
      columns: [],
    };

    const result = transformToDataSources(input);
    expect(result.primary.data.fields).toEqual([]);
    expect(result.primary.data.columns).toEqual([]);
  });

  it("converts null/undefined values to empty strings in non-numeric columns", () => {
    const input: SplunkJsonColsResponse = {
      fields: [{ name: "host" }],
      columns: [[null, "server1", undefined]],
    };

    const result = transformToDataSources(input);
    expect(result.primary.data.columns[0]).toEqual(["", "server1", ""]);
  });
});

describe("summarizeResults", () => {
  it("summarizes a basic response", () => {
    const input: SplunkJsonColsResponse = {
      fields: [{ name: "host" }, { name: "count" }],
      columns: [
        ["server1", "server2"],
        [10, 20],
      ],
    };

    const result = summarizeResults(input);
    expect(result).toContain("2 row(s)");
    expect(result).toContain("2 field(s)");
    expect(result).toContain("host, count");
    expect(result).toContain("host=server1, count=10");
    expect(result).toContain("host=server2, count=20");
  });

  it("returns no results for empty response", () => {
    const input: SplunkJsonColsResponse = {
      fields: [],
      columns: [],
    };

    expect(summarizeResults(input)).toBe("No results returned.");
  });

  it("truncates to maxRows", () => {
    const input: SplunkJsonColsResponse = {
      fields: [{ name: "idx" }],
      columns: [Array.from({ length: 50 }, (_, i) => i)],
    };

    const result = summarizeResults(input, 5);
    expect(result).toContain("50 row(s)");
    expect(result).toContain("... (45 more rows)");
    const lines = result.trim().split("\n");
    // 1 header + 5 data rows + 1 truncation notice
    expect(lines.length).toBe(7);
  });
});
