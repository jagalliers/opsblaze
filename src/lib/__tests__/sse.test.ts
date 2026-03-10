import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamChat, type SSECallbacks } from "../sse.js";

function mockFetchResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let idx = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(encoder.encode(chunks[idx]));
        idx++;
      } else {
        controller.close();
      }
    },
  });

  return {
    ok: true,
    status: 200,
    body: stream,
    text: async () => "",
  } as unknown as Response;
}

function makeCallbacks(overrides: Partial<SSECallbacks> = {}): SSECallbacks {
  return {
    onText: vi.fn(),
    onChart: vi.fn(),
    onSkill: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
}

describe("streamChat SSE parser", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses text events", async () => {
    const chunks = [
      'event: text\ndata: {"content":"Hello "}\n\n',
      'event: text\ndata: {"content":"world"}\n\n',
      "event: done\ndata: {}\n\n",
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const texts: string[] = [];
    const cb = makeCallbacks({ onText: (t) => texts.push(t) });

    await streamChat("hi", [], cb);
    expect(texts).toEqual(["Hello ", "world"]);
    expect(cb.onDone).toHaveBeenCalled();
  });

  it("parses chart events", async () => {
    const chartData = {
      vizType: "bar",
      dataSources: { primary: { data: { fields: [], columns: [] } } },
      width: 800,
      height: 400,
    };

    const chunks = [
      `event: chart\ndata: ${JSON.stringify(chartData)}\n\n`,
      "event: done\ndata: {}\n\n",
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const charts: unknown[] = [];
    const cb = makeCallbacks({ onChart: (d) => charts.push(d) });

    await streamChat("q", [], cb);
    expect(charts).toHaveLength(1);
    expect(charts[0]).toEqual(chartData);
  });

  it("parses skill events", async () => {
    const chunks = [
      'event: skill\ndata: {"skill":"splunk-analyst"}\n\n',
      "event: done\ndata: {}\n\n",
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const skills: string[] = [];
    const cb = makeCallbacks({ onSkill: (s) => skills.push(s) });

    await streamChat("q", [], cb);
    expect(skills).toEqual(["splunk-analyst"]);
  });

  it("parses error events", async () => {
    const chunks = [
      'event: error\ndata: {"message":"Something broke"}\n\n',
      "event: done\ndata: {}\n\n",
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const errors: string[] = [];
    const cb = makeCallbacks({ onError: (m) => errors.push(m) });

    await streamChat("q", [], cb);
    expect(errors).toEqual(["Something broke"]);
  });

  it("handles split chunks across read boundaries", async () => {
    const chunks = ['event: text\ndata: {"con', 'tent":"split"}\n\nevent: done\ndata: {}\n\n'];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const texts: string[] = [];
    const cb = makeCallbacks({ onText: (t) => texts.push(t) });

    await streamChat("q", [], cb);
    expect(texts).toEqual(["split"]);
  });

  it("skips malformed JSON data gracefully", async () => {
    const chunks = [
      "event: text\ndata: {invalid json}\n\n",
      'event: text\ndata: {"content":"valid"}\n\n',
      "event: done\ndata: {}\n\n",
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const texts: string[] = [];
    const cb = makeCallbacks({ onText: (t) => texts.push(t) });

    await streamChat("q", [], cb);
    expect(texts).toEqual(["valid"]);
  });

  it("stops processing on done event", async () => {
    const chunks = [
      'event: text\ndata: {"content":"before"}\n\n',
      "event: done\ndata: {}\n\n",
      'event: text\ndata: {"content":"after"}\n\n',
    ];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const texts: string[] = [];
    const cb = makeCallbacks({ onText: (t) => texts.push(t) });

    await streamChat("q", [], cb);
    expect(texts).toEqual(["before"]);
  });

  it("handles empty content gracefully", async () => {
    const chunks = ["event: text\ndata: {}\n\n", "event: done\ndata: {}\n\n"];

    vi.stubGlobal("fetch", async () => mockFetchResponse(chunks));

    const texts: string[] = [];
    const cb = makeCallbacks({ onText: (t) => texts.push(t) });

    await streamChat("q", [], cb);
    expect(texts).toEqual([""]);
  });

  it("throws on non-ok HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        ({
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        }) as unknown as Response
    );

    const cb = makeCallbacks();
    await expect(streamChat("q", [], cb)).rejects.toThrow("Server error (500)");
  });

  it("throws when response body is missing", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        ({
          ok: true,
          status: 200,
          body: null,
          text: async () => "",
        }) as unknown as Response
    );

    const cb = makeCallbacks();
    await expect(streamChat("q", [], cb)).rejects.toThrow("No response body");
  });

  it("includes skills in request body when provided", async () => {
    const chunks = ["event: done\ndata: {}\n\n"];
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse(chunks);
    });

    const cb = makeCallbacks();
    await streamChat("q", [], cb, undefined, [
      "splunk-analyst",
      "splunk-login-activity-investigation",
    ]);

    expect(capturedBody.skills).toEqual(["splunk-analyst", "splunk-login-activity-investigation"]);
    expect(capturedBody.message).toBe("q");
  });

  it("omits skills from request body when not provided", async () => {
    const chunks = ["event: done\ndata: {}\n\n"];
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse(chunks);
    });

    const cb = makeCallbacks();
    await streamChat("q", [], cb);

    expect(capturedBody).not.toHaveProperty("skills");
  });

  it("omits skills when explicitly passed as undefined (advisory mode path)", async () => {
    const chunks = ["event: done\ndata: {}\n\n"];
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse(chunks);
    });

    const cb = makeCallbacks();
    await streamChat("q", [], cb, undefined, undefined);

    expect(capturedBody).not.toHaveProperty("skills");
    expect(capturedBody.message).toBe("q");
  });

  it("includes skills in strict mode path", async () => {
    const chunks = ["event: done\ndata: {}\n\n"];
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse(chunks);
    });

    const cb = makeCallbacks();
    await streamChat("q", [], cb, undefined, ["skill-a", "skill-b"]);

    expect(capturedBody.skills).toEqual(["skill-a", "skill-b"]);
    expect(capturedBody.message).toBe("q");
  });

  it("omits skills from request body when array is empty", async () => {
    const chunks = ["event: done\ndata: {}\n\n"];
    let capturedBody: Record<string, unknown> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockFetchResponse(chunks);
    });

    const cb = makeCallbacks();
    await streamChat("q", [], cb, undefined, []);

    expect(capturedBody).not.toHaveProperty("skills");
  });
});
