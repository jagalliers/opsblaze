import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import path from "path";
import os from "os";
import { recordMessages } from "../recorder.js";

let tmpDir: string;

async function makeTmpDir() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "opsblaze-rec-"));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

async function* generateMessages(
  messages: Record<string, unknown>[]
): AsyncGenerator<Record<string, unknown>> {
  for (const msg of messages) yield msg;
}

async function collectAll(gen: AsyncGenerator<Record<string, unknown>>) {
  const items: Record<string, unknown>[] = [];
  for await (const msg of gen) items.push(msg);
  return items;
}

describe("recordMessages", () => {
  it("yields all messages unchanged", async () => {
    const dir = await makeTmpDir();
    const outputPath = path.join(dir, "test.jsonl");
    const messages = [
      { type: "a", data: 1 },
      { type: "b", data: 2 },
    ];

    const result = await collectAll(recordMessages(generateMessages(messages), outputPath));
    expect(result).toEqual(messages);
  });

  it("writes JSONL file with one line per message", async () => {
    const dir = await makeTmpDir();
    const outputPath = path.join(dir, "test.jsonl");
    const messages = [
      { type: "text", content: "hello" },
      { type: "chart", vizType: "bar" },
      { type: "result" },
    ];

    await collectAll(recordMessages(generateMessages(messages), outputPath));

    const raw = await readFile(outputPath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(3);

    for (let i = 0; i < lines.length; i++) {
      expect(JSON.parse(lines[i])).toEqual(messages[i]);
    }
  });

  it("creates parent directories", async () => {
    const dir = await makeTmpDir();
    const nested = path.join(dir, "sub", "dir", "test.jsonl");
    const messages = [{ type: "msg" }];

    await collectAll(recordMessages(generateMessages(messages), nested));

    const raw = await readFile(nested, "utf-8");
    expect(raw.trim()).toBe(JSON.stringify(messages[0]));
  });

  it("handles empty message stream", async () => {
    const dir = await makeTmpDir();
    const outputPath = path.join(dir, "empty.jsonl");

    const result = await collectAll(recordMessages(generateMessages([]), outputPath));
    expect(result).toEqual([]);

    const raw = await readFile(outputPath, "utf-8");
    expect(raw).toBe("");
  });

  it("preserves complex nested objects", async () => {
    const dir = await makeTmpDir();
    const outputPath = path.join(dir, "complex.jsonl");
    const complex = {
      type: "tool_result",
      content: [{ type: "text", text: '{"chart": {"vizType": "bar"}}' }],
      nested: { a: { b: [1, 2, 3] } },
    };

    await collectAll(recordMessages(generateMessages([complex]), outputPath));

    const raw = await readFile(outputPath, "utf-8");
    expect(JSON.parse(raw.trim())).toEqual(complex);
  });
});
