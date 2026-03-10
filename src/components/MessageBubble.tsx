import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { marked } from "marked";
import { SplunkChart } from "./SplunkChart";
import type { Message, ChartBlock, SkillBlock } from "../types";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "table", "thead", "tbody", "tr", "th", "td"],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), "className"],
    th: [...(defaultSchema.attributes?.th ?? []), "style"],
    td: [...(defaultSchema.attributes?.td ?? []), "style"],
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
  },
};

/**
 * Convert GFM-style markdown tables to HTML tables so ReactMarkdown
 * can render them without remark-gfm (which conflicts with
 * @splunk/react-ui's bundled micromark@3).
 */
function convertMarkdownTables(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const headerLine = lines[i];
    const separatorLine = lines[i + 1];

    if (separatorLine && isTableRow(headerLine) && /^\|[\s:|-]+\|$/.test(separatorLine.trim())) {
      const headers = parseRow(headerLine);
      const aligns = parseSeparator(separatorLine);
      const rows: string[][] = [];

      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(parseRow(lines[j]));
        j++;
      }

      out.push(buildHtmlTable(headers, aligns, rows));
      i = j;
    } else {
      out.push(lines[i]);
      i++;
    }
  }

  return out.join("\n");
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}

function parseRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function parseSeparator(line: string): Array<"left" | "center" | "right" | null> {
  return parseRow(line).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

function cellToHtml(text: string): string {
  const html = marked.parseInline(text) as string;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\bon\w+\s*=\s*[^\s>"'][^\s>]*/gi, "")
    .replace(/href\s*=\s*["']?\s*javascript:/gi, 'href="#" data-blocked="')
    .replace(/href\s*=\s*["']?\s*data:/gi, 'href="#" data-blocked="')
    .replace(/src\s*=\s*["']?\s*javascript:/gi, 'src="" data-blocked="')
    .replace(/src\s*=\s*["']?\s*data:/gi, 'src="" data-blocked="');
}

function buildHtmlTable(
  headers: string[],
  aligns: Array<"left" | "center" | "right" | null>,
  rows: string[][]
): string {
  const alignAttr = (i: number) => {
    const a = aligns[i];
    return a ? ` style="text-align:${a}"` : "";
  };

  const ths = headers.map((h, i) => `<th${alignAttr(i)}>${cellToHtml(h)}</th>`).join("");
  const thead = `<thead><tr>${ths}</tr></thead>`;

  const tbody = rows
    .map((row) => {
      const tds = row.map((c, i) => `<td${alignAttr(i)}>${cellToHtml(c)}</td>`).join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  return `\n<div class="table-wrap"><table>${thead}<tbody>${tbody}</tbody></table></div>\n`;
}

const MAX_RESULTS_ROWS = 50;

function SplunkQueryDetails({ block }: { block: ChartBlock }) {
  if (!block.spl) return null;

  const { fields, columns } = block.dataSources.primary.data;
  const rowCount = columns[0]?.length ?? 0;
  const displayRows = Math.min(rowCount, MAX_RESULTS_ROWS);

  return (
    <details className="spl-details">
      <summary className="spl-details-summary">
        <span className="spl-details-label">SPL</span>
      </summary>
      <div className="spl-details-content">
        <div className="spl-details-query">
          <pre>
            <code>{block.spl}</code>
          </pre>
          <span className="spl-details-time">
            {block.earliest ?? "-24h"} &rarr; {block.latest ?? "now"}
          </span>
        </div>
        {rowCount > 0 && (
          <div className="spl-details-results">
            <div className="spl-details-results-header">
              Results ({rowCount} row{rowCount !== 1 ? "s" : ""})
              {rowCount > MAX_RESULTS_ROWS && (
                <span className="spl-details-truncated"> — showing first {MAX_RESULTS_ROWS}</span>
              )}
            </div>
            <div className="spl-details-table-wrap">
              <table>
                <thead>
                  <tr>
                    {fields.map((f, fi) => (
                      <th key={fi}>{f.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: displayRows }, (_, ri) => (
                    <tr key={ri}>
                      {columns.map((col, ci) => (
                        <td key={ci}>
                          {col[ri] === null || col[ri] === undefined ? "" : String(col[ri])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl px-4 py-2.5 rounded-2xl rounded-br-md bg-accent/15 border border-accent/20 text-gray-200 text-sm">
          {message.blocks.map((block, i) =>
            block.type === "text" ? <span key={i}>{block.content}</span> : null
          )}
        </div>
      </div>
    );
  }

  const hasContent = message.blocks.some((b) => b.type === "text" && b.content.trim());
  const lastBlock = message.blocks[message.blocks.length - 1];
  const lastBlockIsStreamingText = lastBlock?.type === "text" && message.isStreaming;
  const showTrailingIndicator = message.isStreaming && !lastBlockIsStreamingText;

  return (
    <div className="flex justify-start">
      <div className="max-w-full w-full">
        {message.blocks.map((block, i) => {
          if (block.type === "text") {
            if (!block.content.trim()) return null;
            const isLastTextBlock = i === message.blocks.length - 1 && message.isStreaming;
            const processed = convertMarkdownTables(block.content);
            if (import.meta.env.DEV) {
              const headingIssue = processed.match(/^#{2,3}\s.+\S[A-Z]/m);
              if (headingIssue) {
                console.warn("[MessageBubble] heading concat:", JSON.stringify(headingIssue[0]));
              }
            }
            return (
              <div
                key={i}
                className={`prose-narrative text-sm ${isLastTextBlock ? "typing-cursor" : ""}`}
              >
                <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}>
                  {processed}
                </ReactMarkdown>
              </div>
            );
          }

          if (block.type === "skill") {
            return (
              <div key={i} className="skill-indicator">
                <span className="skill-indicator-icon">&#x2728;</span>
                Using skill: <span className="skill-indicator-name">{block.skill}</span>
              </div>
            );
          }

          if (block.type === "chart") {
            return (
              <div key={i} className="splunk-chart-container my-4">
                <SplunkChart
                  vizType={block.vizType}
                  dataSources={block.dataSources}
                  width={block.width}
                  height={block.height}
                />
                <SplunkQueryDetails block={block} />
              </div>
            );
          }

          return null;
        })}

        {showTrailingIndicator && (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent/50 animate-pulse" />
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent/50 animate-pulse"
                style={{ animationDelay: "0.15s" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent/50 animate-pulse"
                style={{ animationDelay: "0.3s" }}
              />
            </div>
            {hasContent ? "Thinking..." : "Analyzing..."}
          </div>
        )}
      </div>
    </div>
  );
}
