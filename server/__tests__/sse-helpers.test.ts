import { describe, it, expect, vi } from "vitest";
import { sendSSE, chartHasData, processTextBuffer } from "../sse-helpers.js";
import type { FlushTextState } from "../sse-helpers.js";

function mockRes(opts: { writableEnded?: boolean; destroyed?: boolean } = {}) {
  return {
    writableEnded: opts.writableEnded ?? false,
    destroyed: opts.destroyed ?? false,
    write: vi.fn(),
  } as unknown as import("express").Response;
}

describe("sendSSE", () => {
  it("writes correctly formatted SSE event", () => {
    const res = mockRes();
    sendSSE(res, "text", { content: "hello" });
    expect(res.write).toHaveBeenCalledWith('event: text\ndata: {"content":"hello"}\n\n');
  });

  it("skips write when res.writableEnded is true", () => {
    const res = mockRes({ writableEnded: true });
    sendSSE(res, "text", { content: "hello" });
    expect(res.write).not.toHaveBeenCalled();
  });

  it("skips write when res.destroyed is true", () => {
    const res = mockRes({ destroyed: true });
    sendSSE(res, "text", { content: "hello" });
    expect(res.write).not.toHaveBeenCalled();
  });

  it("serializes complex data correctly", () => {
    const res = mockRes();
    sendSSE(res, "chart", { vizType: "bar", dataSources: { primary: {} } });
    const written = (res.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(written).toContain("event: chart\n");
    expect(JSON.parse(written.split("data: ")[1].trim())).toEqual({
      vizType: "bar",
      dataSources: { primary: {} },
    });
  });
});

describe("chartHasData", () => {
  it("returns true for valid dataSources with rows", () => {
    const ds = {
      primary: {
        data: {
          columns: [
            ["a", "b"],
            [1, 2],
          ],
        },
      },
    };
    expect(chartHasData(ds)).toBe(true);
  });

  it("returns false for empty columns", () => {
    expect(chartHasData({ primary: { data: { columns: [] } } })).toBe(false);
  });

  it("returns false for columns with empty first array", () => {
    expect(chartHasData({ primary: { data: { columns: [[]] } } })).toBe(false);
  });

  it("returns false for null/undefined input", () => {
    expect(chartHasData(null)).toBe(false);
    expect(chartHasData(undefined)).toBe(false);
  });

  it("returns false for missing primary key", () => {
    expect(chartHasData({})).toBe(false);
    expect(chartHasData({ other: {} })).toBe(false);
  });

  it("returns false for missing data key", () => {
    expect(chartHasData({ primary: {} })).toBe(false);
  });

  it("returns false for non-array columns", () => {
    expect(chartHasData({ primary: { data: { columns: "invalid" } } })).toBe(false);
  });
});

describe("processTextBuffer", () => {
  function collect() {
    const events: Array<{ event: string; data: unknown }> = [];
    const emit = (event: string, data: unknown) => events.push({ event, data });
    return { events, emit };
  }

  it("emits plain text and clears buffer", () => {
    const { events, emit } = collect();
    const state: FlushTextState = { textBuffer: "Hello world", inChartTag: false };
    const result = processTextBuffer(state, false, emit);
    expect(events).toEqual([{ event: "text", data: { content: "Hello world" } }]);
    expect(result.textBuffer).toBe("");
  });

  it("is a no-op for empty buffer", () => {
    const { events, emit } = collect();
    const state: FlushTextState = { textBuffer: "", inChartTag: false };
    const result = processTextBuffer(state, false, emit);
    expect(events).toHaveLength(0);
    expect(result.textBuffer).toBe("");
  });

  it("extracts chart tag and emits chart event with valid data", () => {
    const { events, emit } = collect();
    const chartData = {
      vizType: "bar",
      dataSources: { primary: { data: { columns: [["a"], [1]] } } },
    };
    const text = `Before<chart>${JSON.stringify(chartData)}</chart>After`;
    const state: FlushTextState = { textBuffer: text, inChartTag: false };
    const result = processTextBuffer(state, true, emit);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ event: "text", data: { content: "Before" } });
    expect(events[1]).toEqual({ event: "chart", data: chartData });
    expect(events[2]).toEqual({ event: "text", data: { content: "After" } });
    expect(result.textBuffer).toBe("");
  });

  it("drops chart tag with empty dataSources", () => {
    const { events, emit } = collect();
    const chartData = {
      vizType: "bar",
      dataSources: { primary: { data: { columns: [] } } },
    };
    const text = `Before<chart>${JSON.stringify(chartData)}</chart>After`;
    const state: FlushTextState = { textBuffer: text, inChartTag: false };
    const result = processTextBuffer(state, true, emit);
    expect(events).toEqual([
      { event: "text", data: { content: "Before" } },
      { event: "text", data: { content: "After" } },
    ]);
    expect(result.textBuffer).toBe("");
  });

  it("drops malformed chart JSON silently", () => {
    const { events, emit } = collect();
    const text = "Before<chart>not-json</chart>After";
    const state: FlushTextState = { textBuffer: text, inChartTag: false };
    const result = processTextBuffer(state, true, emit);
    expect(events).toEqual([
      { event: "text", data: { content: "Before" } },
      { event: "text", data: { content: "After" } },
    ]);
    expect(result.textBuffer).toBe("");
  });

  it("holds partial chart tag when not forced", () => {
    const { events, emit } = collect();
    const text = "Hello<cha";
    const state: FlushTextState = { textBuffer: text, inChartTag: false };
    const result = processTextBuffer(state, false, emit);
    expect(events).toEqual([{ event: "text", data: { content: "Hello" } }]);
    expect(result.textBuffer).toBe("<cha");
  });

  it("flushes partial chart tag when forced", () => {
    const { events, emit } = collect();
    const text = "Hello<cha";
    const state: FlushTextState = { textBuffer: text, inChartTag: false };
    const result = processTextBuffer(state, true, emit);
    expect(events).toEqual([{ event: "text", data: { content: "Hello<cha" } }]);
    expect(result.textBuffer).toBe("");
  });

  it("buffers incomplete chart tag (open without close)", () => {
    const { events, emit } = collect();
    const text = "Before<chart>partial json here";
    const state: FlushTextState = { textBuffer: text, inChartTag: false };
    const result = processTextBuffer(state, false, emit);
    expect(events).toEqual([{ event: "text", data: { content: "Before" } }]);
    expect(result.inChartTag).toBe(true);
    expect(result.textBuffer).toBe("<chart>partial json here");
  });

  it("handles multiple chart tags in sequence", () => {
    const { events, emit } = collect();
    const c1 = { vizType: "line", dataSources: { primary: { data: { columns: [["x"], [1]] } } } };
    const c2 = { vizType: "bar", dataSources: { primary: { data: { columns: [["y"], [2]] } } } };
    const text = `A<chart>${JSON.stringify(c1)}</chart>B<chart>${JSON.stringify(c2)}</chart>C`;
    const state: FlushTextState = { textBuffer: text, inChartTag: false };
    const result = processTextBuffer(state, true, emit);
    expect(events).toEqual([
      { event: "text", data: { content: "A" } },
      { event: "chart", data: c1 },
      { event: "text", data: { content: "B" } },
      { event: "chart", data: c2 },
      { event: "text", data: { content: "C" } },
    ]);
    expect(result.textBuffer).toBe("");
  });
});
