import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let mod: typeof import("../api.js");

function mockFetch(status: number, body: unknown = {}): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(async () => {
  vi.resetModules();
  mod = await import("../api.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("headers", () => {
  it("always includes Content-Type", () => {
    const h = mod.headers();
    expect(h["Content-Type"]).toBe("application/json");
  });
});

describe("listConversations", () => {
  it("sends GET to /api/conversations", async () => {
    const items = [{ id: "1", title: "Test" }];
    const fn = mockFetch(200, items);
    const result = await mod.listConversations();
    expect(fn).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result).toEqual(items);
  });

  it("throws on non-ok response", async () => {
    mockFetch(500);
    await expect(mod.listConversations()).rejects.toThrow("Failed to list conversations: 500");
  });
});

describe("loadConversation", () => {
  it("sends GET to /api/conversations/:id", async () => {
    const conv = { id: "abc", title: "Hello", messages: [] };
    const fn = mockFetch(200, conv);
    const result = await mod.loadConversation("abc");
    expect(fn).toHaveBeenCalledWith("/api/conversations/abc", expect.any(Object));
    expect(result).toEqual(conv);
  });

  it("throws on 404", async () => {
    mockFetch(404);
    await expect(mod.loadConversation("missing")).rejects.toThrow(
      "Failed to load conversation: 404"
    );
  });
});

describe("createConversation", () => {
  it("sends POST with id, title, and empty messages", async () => {
    const created = { id: "new-1", title: "New", messages: [] };
    const fn = mockFetch(201, created);
    const result = await mod.createConversation("new-1", "New");
    expect(fn).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: "new-1", title: "New", messages: [] }),
      })
    );
    expect(result).toEqual(created);
  });

  it("throws on error response", async () => {
    mockFetch(400);
    await expect(mod.createConversation("x", "Y")).rejects.toThrow(
      "Failed to create conversation: 400"
    );
  });
});

describe("updateConversation", () => {
  it("sends PUT with data", async () => {
    const updated = { id: "u1", title: "Updated", messages: [{ role: "user", content: "hi" }] };
    const fn = mockFetch(200, updated);
    await mod.updateConversation("u1", { title: "Updated" });
    expect(fn).toHaveBeenCalledWith(
      "/api/conversations/u1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ title: "Updated" }),
      })
    );
  });

  it("throws on 500", async () => {
    mockFetch(500);
    await expect(mod.updateConversation("u1", { title: "X" })).rejects.toThrow(
      "Failed to update conversation: 500"
    );
  });
});

describe("deleteConversation", () => {
  it("sends DELETE to /api/conversations/:id", async () => {
    const fn = mockFetch(200);
    await mod.deleteConversation("del-1");
    expect(fn).toHaveBeenCalledWith(
      "/api/conversations/del-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("throws on non-ok response", async () => {
    mockFetch(403);
    await expect(mod.deleteConversation("x")).rejects.toThrow("Failed to delete conversation: 403");
  });
});

describe("fetchHealth", () => {
  it("sends GET to /api/health", async () => {
    const health = { status: "ok", checks: {} };
    const fn = mockFetch(200, health);
    const result = await mod.fetchHealth();
    expect(fn).toHaveBeenCalledWith("/api/health", expect.any(Object));
    expect(result).toEqual(health);
  });
});

describe("searchConversations", () => {
  it("sends GET with encoded query parameter", async () => {
    const results = [{ id: "1", title: "Match", snippet: "...match..." }];
    const fn = mockFetch(200, results);
    await mod.searchConversations("failed login");
    expect(fn).toHaveBeenCalledWith(
      "/api/conversations/search?q=failed%20login",
      expect.any(Object)
    );
  });

  it("throws on error response", async () => {
    mockFetch(500);
    await expect(mod.searchConversations("test")).rejects.toThrow("Search failed: 500");
  });
});
