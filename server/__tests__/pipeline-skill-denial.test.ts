import { describe, it, expect } from "vitest";
import { processMessageStream } from "../pipeline.js";
import type { PipelineEmitter } from "../pipeline.js";

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

function skillToolMessages(skillName: string) {
  return [
    {
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Skill", id: "tu_1" },
      },
    },
    {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify({ skill: skillName }),
        },
      },
    },
    {
      type: "stream_event",
      event: { type: "content_block_stop" },
    },
  ];
}

function hookResponseMessage() {
  return {
    type: "system",
    subtype: "hook_response",
    hook_id: "h_1",
    hook_name: "PreToolUse",
    hook_event: "PreToolUse",
    outcome: "success",
    output: "",
    stdout: "",
    stderr: "",
  };
}

function userTurnMessage() {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: "Skill content loaded" }],
    },
  };
}

function textDelta(text: string) {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  };
}

function resultMessage() {
  return { type: "result", subtype: "success" };
}

async function runPipeline(messages: Record<string, unknown>[], deniedSkills?: Set<string>) {
  const events: SSEEvent[] = [];

  async function* generate() {
    for (const m of messages) yield m;
  }

  const emitter: PipelineEmitter = {
    emit: (event: string, data: unknown) => events.push({ event, data }),
    log: silentLog,
  };

  const result = await processMessageStream(generate(), emitter, undefined, deniedSkills);
  return { events, result };
}

describe("pipeline: skill denial deferred emission", () => {
  it("emits skill after hook confirms allow", async () => {
    const denied = new Set<string>();
    const messages = [
      ...skillToolMessages("splunk-analyst"),
      hookResponseMessage(),
      resultMessage(),
    ];

    const { events, result } = await runPipeline(messages, denied);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(1);
    expect((skillEvents[0].data as { skill: string }).skill).toBe("splunk-analyst");
    expect(result.skillsUsed).toContain("splunk-analyst");
  });

  it("suppresses skill indicator when hook denies", async () => {
    const denied = new Set<string>(["rogue-skill"]);
    const messages = [...skillToolMessages("rogue-skill"), hookResponseMessage(), resultMessage()];

    const { events, result } = await runPipeline(messages, denied);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(0);
    expect(result.skillsUsed).toContain("rogue-skill");
  });

  it("emits immediately when no deniedSkills set is provided", async () => {
    const messages = [...skillToolMessages("splunk-analyst"), resultMessage()];

    const { events } = await runPipeline(messages, undefined);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(1);
    expect((skillEvents[0].data as { skill: string }).skill).toBe("splunk-analyst");
  });

  it("flushes pending skills at stream end if no hook_response arrived", async () => {
    const denied = new Set<string>();
    const messages = [...skillToolMessages("splunk-analyst"), resultMessage()];

    const { events } = await runPipeline(messages, denied);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(1);
    expect((skillEvents[0].data as { skill: string }).skill).toBe("splunk-analyst");
  });

  it("handles mixed allowed and denied skills correctly", async () => {
    const denied = new Set<string>(["bad-skill"]);
    const messages = [
      ...skillToolMessages("good-skill"),
      hookResponseMessage(),
      ...skillToolMessages("bad-skill"),
      hookResponseMessage(),
      resultMessage(),
    ];

    const { events, result } = await runPipeline(messages, denied);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(1);
    expect((skillEvents[0].data as { skill: string }).skill).toBe("good-skill");
    expect(result.skillsUsed).toEqual(["good-skill", "bad-skill"]);
  });

  it("suppresses denied skills at stream end when no hook_response arrived", async () => {
    const denied = new Set<string>(["denied-skill"]);
    const messages = [...skillToolMessages("denied-skill"), resultMessage()];

    const { events } = await runPipeline(messages, denied);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(0);
  });

  it("drains pending skills at user turn boundary (bypassPermissions path)", async () => {
    const denied = new Set<string>();
    const messages = [
      ...skillToolMessages("splunk-analyst"),
      userTurnMessage(),
      textDelta("Hello from the model"),
      resultMessage(),
    ];

    const { events, result } = await runPipeline(messages, denied);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(1);
    expect((skillEvents[0].data as { skill: string }).skill).toBe("splunk-analyst");

    const skillIdx = events.indexOf(skillEvents[0]);
    const textEvents = events.filter((e) => e.event === "text");
    const firstTextIdx = events.indexOf(textEvents[0]);
    expect(skillIdx).toBeLessThan(firstTextIdx);
    expect(result.skillsUsed).toContain("splunk-analyst");
  });

  it("suppresses denied skills at user turn boundary", async () => {
    const denied = new Set<string>(["denied-skill"]);
    const messages = [
      ...skillToolMessages("denied-skill"),
      userTurnMessage(),
      textDelta("Response text"),
      resultMessage(),
    ];

    const { events } = await runPipeline(messages, denied);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(0);
  });

  it("does not double-emit when hook_response and user turn both drain", async () => {
    const denied = new Set<string>();
    const messages = [
      ...skillToolMessages("splunk-analyst"),
      hookResponseMessage(),
      userTurnMessage(),
      resultMessage(),
    ];

    const { events } = await runPipeline(messages, denied);

    const skillEvents = events.filter((e) => e.event === "skill");
    expect(skillEvents).toHaveLength(1);
  });
});
