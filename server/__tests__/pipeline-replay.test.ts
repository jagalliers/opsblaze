import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { processMessageStream } from "../pipeline.js";
import type { PipelineEmitter } from "../pipeline.js";
import { chartHasData } from "../sse-helpers.js";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => silentLog,
  bindings: () => ({}),
  level: "silent",
  isLevelEnabled: () => false,
} as unknown as import("pino").Logger;

interface SSEEvent {
  event: string;
  data: unknown;
}

async function replayFixture(fixturePath: string) {
  const lines = readFileSync(fixturePath, "utf-8").split("\n").filter(Boolean);
  const events: SSEEvent[] = [];

  async function* generateMessages() {
    for (const line of lines) yield JSON.parse(line);
  }

  const emitter: PipelineEmitter = {
    emit: (event: string, data: unknown) => events.push({ event, data }),
    log: silentLog,
  };

  const result = await processMessageStream(generateMessages(), emitter);
  return { events, result };
}

describe("pipeline replay: happy-path", () => {
  it("emits text, chart, and more text in correct order", async () => {
    const { events, result } = await replayFixture(path.join(FIXTURES_DIR, "happy-path.jsonl"));

    expect(result.turnCount).toBe(1);

    const textEvents = events.filter((e) => e.event === "text");
    const chartEvents = events.filter((e) => e.event === "chart");

    expect(textEvents.length).toBeGreaterThanOrEqual(2);
    expect(chartEvents).toHaveLength(1);

    const allText = textEvents.map((e) => (e.data as { content: string }).content).join("");
    expect(allText).toContain("Let me search for login activity.");
    expect(allText).toContain("The data shows 100 events.");

    const chart = chartEvents[0].data as { vizType: string; dataSources: unknown };
    expect(chart.vizType).toBe("bar");
    expect(chartHasData(chart.dataSources)).toBe(true);
  });

  it("emits chart event between pre-tool text and post-tool text", async () => {
    const { events } = await replayFixture(path.join(FIXTURES_DIR, "happy-path.jsonl"));

    const eventTypes = events.map((e) => e.event);
    const firstChart = eventTypes.indexOf("chart");
    const textBefore = eventTypes.slice(0, firstChart).includes("text");
    const textAfter = eventTypes.slice(firstChart + 1).includes("text");

    expect(textBefore).toBe(true);
    expect(textAfter).toBe(true);
  });
});

describe("pipeline replay: heading after suppressed tool", () => {
  it("injects paragraph break between tool result and heading", async () => {
    const { events } = await replayFixture(
      path.join(FIXTURES_DIR, "heading-after-suppressed-tool.jsonl")
    );

    const chartEvents = events.filter((e) => e.event === "chart");
    expect(chartEvents).toHaveLength(0);

    const allText = events
      .filter((e) => e.event === "text")
      .map((e) => (e.data as { content: string }).content)
      .join("");

    expect(allText).toContain("Let me discover SSH data sources.");
    expect(allText).toContain("### Step 1");
    expect(allText).toContain("No results in the past 7 days.");

    const beforeHeading = allText.indexOf("### Step 1");
    const textUpToHeading = allText.slice(Math.max(0, beforeHeading - 10), beforeHeading);
    expect(textUpToHeading).toContain("\n\n");
  });
});

describe("pipeline replay: truncated narrative", () => {
  it("flushes final text after last tool result", async () => {
    const { events } = await replayFixture(path.join(FIXTURES_DIR, "truncated-narrative.jsonl"));

    const allText = events
      .filter((e) => e.event === "text")
      .map((e) => (e.data as { content: string }).content)
      .join("");

    expect(allText).toContain("final narrative that was at risk of being truncated");
  });

  it("emits chart from tool result", async () => {
    const { events } = await replayFixture(path.join(FIXTURES_DIR, "truncated-narrative.jsonl"));

    const chartEvents = events.filter((e) => e.event === "chart");
    expect(chartEvents).toHaveLength(1);
    expect((chartEvents[0].data as { vizType: string }).vizType).toBe("bar");
  });
});

describe("pipeline replay: invariants across all fixtures", () => {
  const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".jsonl"));

  for (const file of fixtureFiles) {
    describe(file, () => {
      it("completes without throwing", async () => {
        await expect(replayFixture(path.join(FIXTURES_DIR, file))).resolves.toBeDefined();
      });

      it("emits at least one text event", async () => {
        const { events } = await replayFixture(path.join(FIXTURES_DIR, file));
        const textEvents = events.filter((e) => e.event === "text");
        expect(textEvents.length).toBeGreaterThanOrEqual(1);
      });

      it("no text event contains raw <chart> tags", async () => {
        const { events } = await replayFixture(path.join(FIXTURES_DIR, file));
        for (const e of events.filter((e) => e.event === "text")) {
          const content = (e.data as { content: string }).content;
          expect(content).not.toContain("<chart>");
          expect(content).not.toContain("</chart>");
        }
      });

      it("all chart events have valid dataSources", async () => {
        const { events } = await replayFixture(path.join(FIXTURES_DIR, file));
        for (const e of events.filter((e) => e.event === "chart")) {
          const ds = (e.data as { dataSources: unknown }).dataSources;
          expect(chartHasData(ds)).toBe(true);
        }
      });
    });
  }
});
