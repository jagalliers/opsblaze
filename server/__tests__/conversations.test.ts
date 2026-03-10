import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import path from "path";
import os from "os";

let tmpDir: string;
let mod: typeof import("../conversations.js");

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "opsblaze-conv-"));
  vi.stubEnv("OPSBLAZE_DATA_DIR", tmpDir);
  mod = await import("../conversations.js");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("conversations CRUD", () => {
  it("lists empty directory", async () => {
    const list = await mod.listConversations();
    expect(list).toEqual([]);
  });

  it("saves and retrieves a conversation", async () => {
    const conv = {
      id: "test-1",
      title: "Test",
      messages: [{ role: "user", content: "hi" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    await mod.saveConversation(conv);
    const loaded = await mod.getConversation("test-1");
    expect(loaded).toEqual(conv);
  });

  it("lists conversations sorted by updatedAt descending", async () => {
    await mod.saveConversation({
      id: "old",
      title: "Old",
      messages: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await mod.saveConversation({
      id: "new",
      title: "New",
      messages: [{ role: "user", content: "x" }],
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
    const list = await mod.listConversations();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("new");
    expect(list[0].messageCount).toBe(1);
    expect(list[1].id).toBe("old");
  });

  it("deletes a conversation", async () => {
    await mod.saveConversation({
      id: "del-me",
      title: "Bye",
      messages: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const result = await mod.deleteConversation("del-me");
    expect(result).toBe(true);
    const loaded = await mod.getConversation("del-me");
    expect(loaded).toBeNull();
  });

  it("returns false when deleting non-existent", async () => {
    const result = await mod.deleteConversation("nope");
    expect(result).toBe(false);
  });

  it("returns null for non-existent conversation", async () => {
    const loaded = await mod.getConversation("missing");
    expect(loaded).toBeNull();
  });

  it("sanitizes ID to prevent path traversal", async () => {
    await expect(mod.getConversation("../../etc/passwd")).resolves.toBeNull();
  });
});

describe("searchConversations", () => {
  it("finds conversations matching title", async () => {
    await mod.saveConversation({
      id: "s1",
      title: "Failed Login Investigation",
      messages: [{ role: "user", blocks: [{ type: "text", content: "hello" }] }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const results = await mod.searchConversations("Failed Login");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("s1");
    expect(results[0].snippet).toBe("Failed Login Investigation");
  });

  it("finds conversations matching message content", async () => {
    await mod.saveConversation({
      id: "s2",
      title: "General",
      messages: [
        {
          role: "assistant",
          blocks: [{ type: "text", content: "The server experienced a critical outage at 3am." }],
        },
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const results = await mod.searchConversations("critical outage");
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain("critical outage");
  });

  it("returns empty when no match", async () => {
    await mod.saveConversation({
      id: "s3",
      title: "Something",
      messages: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const results = await mod.searchConversations("zzz_no_match_zzz");
    expect(results).toEqual([]);
  });
});

describe("cleanupConversations", () => {
  it("deletes conversations older than maxAgeDays", async () => {
    const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString();
    const recentDate = new Date().toISOString();

    await mod.saveConversation({
      id: "old-conv",
      title: "Old",
      messages: [],
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    await mod.saveConversation({
      id: "recent-conv",
      title: "Recent",
      messages: [],
      createdAt: recentDate,
      updatedAt: recentDate,
    });

    const deleted = await mod.cleanupConversations(30);
    expect(deleted).toBe(1);

    const remaining = await mod.listConversations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("recent-conv");
  });

  it("returns 0 when nothing to delete", async () => {
    const recentDate = new Date().toISOString();
    await mod.saveConversation({
      id: "keep",
      title: "Keep",
      messages: [],
      createdAt: recentDate,
      updatedAt: recentDate,
    });
    const deleted = await mod.cleanupConversations(30);
    expect(deleted).toBe(0);
  });
});
