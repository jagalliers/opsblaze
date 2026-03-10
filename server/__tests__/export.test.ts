import { describe, it, expect, beforeEach } from "vitest";
import { renderExportHtml } from "../export.js";
import type { StoredConversation } from "../conversations.js";

function makeConv(overrides: Partial<StoredConversation> = {}): StoredConversation {
  return {
    id: "test-1",
    title: "Test Investigation",
    messages: [],
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-01-15T11:00:00Z",
    ...overrides,
  };
}

describe("renderExportHtml", () => {
  it("renders valid HTML document structure", () => {
    const html = renderExportHtml(makeConv());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("</html>");
    expect(html).toContain("OpsBlaze Investigation Report");
  });

  it("includes conversation title in header and page title", () => {
    const html = renderExportHtml(makeConv({ title: "Login Analysis" }));
    expect(html).toContain("<title>Login Analysis — OpsBlaze Investigation</title>");
    expect(html).toContain("<h1>Login Analysis</h1>");
  });

  it("renders user messages with correct role", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [{ role: "user", blocks: [{ type: "text", content: "Show me failed logins" }] }],
      })
    );
    expect(html).toContain("user-message");
    expect(html).toContain("You");
    expect(html).toContain("Show me failed logins");
  });

  it("renders assistant messages with correct role", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          { role: "assistant", blocks: [{ type: "text", content: "Here are the results." }] },
        ],
      })
    );
    expect(html).toContain("assistant-message");
    expect(html).toContain("OpsBlaze");
    expect(html).toContain("Here are the results.");
  });

  it("renders markdown in text blocks", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          { role: "assistant", blocks: [{ type: "text", content: "**Bold** and *italic*" }] },
        ],
      })
    );
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("escapes HTML in title to prevent XSS", () => {
    const html = renderExportHtml(makeConv({ title: '<script>alert("xss")</script>' }));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("sanitizes script tags in rendered markdown", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          {
            role: "assistant",
            blocks: [{ type: "text", content: 'Text <script>alert("xss")</script> more' }],
          },
        ],
      })
    );
    expect(html).not.toContain("<script>alert");
  });

  it("sanitizes javascript: hrefs", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          {
            role: "assistant",
            blocks: [{ type: "text", content: '<a href="javascript:alert(1)">click</a>' }],
          },
        ],
      })
    );
    expect(html).not.toContain("javascript:");
  });

  it("renders chart blocks with canvas elements", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          {
            role: "assistant",
            blocks: [
              {
                type: "chart",
                vizType: "bar",
                dataSources: {
                  primary: {
                    data: {
                      fields: [{ name: "host" }, { name: "count" }],
                      columns: [
                        ["srv1", "srv2"],
                        [10, 20],
                      ],
                    },
                  },
                },
                spl: "index=main | stats count by host",
                earliest: "-1h",
                latest: "now",
              },
            ],
          },
        ],
      })
    );
    expect(html).toContain("<canvas");
    expect(html).toContain("chart.js");
    expect(html).toContain("index=main | stats count by host");
    expect(html).toContain("chart-block");
  });

  it("renders singlevalue chart blocks", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          {
            role: "assistant",
            blocks: [
              {
                type: "chart",
                vizType: "singlevalue",
                dataSources: {
                  primary: {
                    data: {
                      fields: [{ name: "count" }],
                      columns: [[42]],
                    },
                  },
                },
              },
            ],
          },
        ],
      })
    );
    expect(html).toContain("single-value-number");
    expect(html).toContain("42");
  });

  it("renders table blocks with data rows", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          {
            role: "assistant",
            blocks: [
              {
                type: "chart",
                vizType: "table",
                dataSources: {
                  primary: {
                    data: {
                      fields: [{ name: "user" }, { name: "action" }],
                      columns: [
                        ["alice", "bob"],
                        ["login", "logout"],
                      ],
                    },
                  },
                },
              },
            ],
          },
        ],
      })
    );
    expect(html).toContain("<table");
    expect(html).toContain("<th>user</th>");
    expect(html).toContain("<td>alice</td>");
    expect(html).toContain("<td>login</td>");
  });

  it("renders skill blocks", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          {
            role: "assistant",
            blocks: [{ type: "skill", skill: "splunk-analyst" }],
          },
        ],
      })
    );
    expect(html).toContain("skill-label");
    expect(html).toContain("splunk-analyst");
  });

  it("handles empty messages array", () => {
    const html = renderExportHtml(makeConv({ messages: [] }));
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).not.toContain('<div class="message ');
  });

  it("escapes HTML in SPL queries within chart blocks", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          {
            role: "assistant",
            blocks: [
              {
                type: "chart",
                vizType: "table",
                dataSources: {
                  primary: {
                    data: {
                      fields: [{ name: "x" }],
                      columns: [["a"]],
                    },
                  },
                },
                spl: 'index=main source="<script>"',
              },
            ],
          },
        ],
      })
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('source="<script>"');
  });

  it("does not include Chart.js script when there are no chartable blocks", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [{ role: "user", blocks: [{ type: "text", content: "hello" }] }],
      })
    );
    expect(html).not.toContain("chart.js");
  });

  it("handles multiple messages in conversation", () => {
    const html = renderExportHtml(
      makeConv({
        messages: [
          { role: "user", blocks: [{ type: "text", content: "Question 1" }] },
          { role: "assistant", blocks: [{ type: "text", content: "Answer 1" }] },
          { role: "user", blocks: [{ type: "text", content: "Question 2" }] },
          { role: "assistant", blocks: [{ type: "text", content: "Answer 2" }] },
        ],
      })
    );
    expect(html).toContain("Question 1");
    expect(html).toContain("Answer 1");
    expect(html).toContain("Question 2");
    expect(html).toContain("Answer 2");
  });
});
