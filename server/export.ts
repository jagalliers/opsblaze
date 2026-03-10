import { marked } from "marked";
import type { StoredConversation } from "./conversations.js";

interface MessageBlock {
  type: string;
  content?: string;
  vizType?: string;
  dataSources?: {
    primary: {
      data: {
        fields: Array<{ name: string }>;
        columns: unknown[][];
      };
    };
  };
  width?: number;
  height?: number;
  spl?: string;
  earliest?: string;
  latest?: string;
  skill?: string;
}

interface ConvMessage {
  role: string;
  blocks: MessageBlock[];
}

interface ChartDef {
  id: string;
  vizType: string;
  labels: string[];
  datasets: Array<{ label: string; data: number[] }>;
}

let chartCounter = 0;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, "")
    .replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"')
    .replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'")
    .replace(/src\s*=\s*"javascript:[^"]*"/gi, 'src=""')
    .replace(/src\s*=\s*'javascript:[^']*'/gi, "src=''");
}

function renderTextBlock(block: MessageBlock): string {
  const content = block.content ?? "";
  if (!content.trim()) return "";
  return sanitizeHtml(marked.parse(content) as string);
}

function renderChartBlock(block: MessageBlock, charts: ChartDef[]): string {
  const parts: string[] = [];
  const vizType = block.vizType ?? "table";
  const ds = block.dataSources;
  const fields = ds?.primary?.data?.fields ?? [];
  const columns = ds?.primary?.data?.columns ?? [];
  const rowCount = columns[0]?.length ?? 0;

  parts.push(`<div class="chart-block">`);

  if (block.spl) {
    parts.push(`<div class="spl-query"><code>${escapeHtml(block.spl)}</code></div>`);
    parts.push(
      `<div class="spl-time">${escapeHtml(block.earliest ?? "-24h")} &rarr; ${escapeHtml(block.latest ?? "now")}</div>`
    );
  }

  const isChartable =
    ["bar", "column", "line", "area", "pie"].includes(vizType) &&
    fields.length >= 2 &&
    rowCount > 0;

  if (vizType === "singlevalue" && rowCount > 0) {
    const val = columns[columns.length - 1]?.[0];
    const label = fields.length > 1 ? fields[fields.length - 1].name : "";
    parts.push(`<div class="single-value">`);
    parts.push(
      `<div class="single-value-number">${val == null ? "—" : escapeHtml(String(val))}</div>`
    );
    if (label) {
      parts.push(`<div class="single-value-label">${escapeHtml(label)}</div>`);
    }
    parts.push(`</div>`);
  } else if (isChartable) {
    const chartId = `chart-${chartCounter++}`;
    const labels = columns[0].map((v) => (v == null ? "" : String(v)));
    const datasets = fields.slice(1).map((f, i) => ({
      label: f.name,
      data: columns[i + 1].map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }),
    }));
    charts.push({ id: chartId, vizType, labels, datasets });
    parts.push(`<div class="chart-canvas-wrap"><canvas id="${chartId}"></canvas></div>`);
  }

  if (rowCount > 0 && vizType !== "singlevalue") {
    const maxRows = Math.min(rowCount, 100);
    const detailsOpen = vizType === "table" ? " open" : "";
    const summary = vizType === "table" ? "Data" : "View raw data";

    parts.push(`<details class="data-details"${detailsOpen}>`);
    parts.push(`<summary>${summary}</summary>`);
    parts.push(`<div class="data-table-wrap">`);
    parts.push(`<table class="data-table">`);
    parts.push(`<thead><tr>`);
    for (const f of fields) {
      parts.push(`<th>${escapeHtml(f.name)}</th>`);
    }
    parts.push(`</tr></thead><tbody>`);
    for (let r = 0; r < maxRows; r++) {
      parts.push(`<tr>`);
      for (const col of columns) {
        const val = col[r];
        parts.push(`<td>${val == null ? "" : escapeHtml(String(val))}</td>`);
      }
      parts.push(`</tr>`);
    }
    parts.push(`</tbody></table>`);
    if (rowCount > maxRows) {
      parts.push(
        `<div class="truncation-note">${rowCount - maxRows} additional rows not shown</div>`
      );
    }
    parts.push(`</div></details>`);
  }

  parts.push(`</div>`);
  return parts.join("\n");
}

function renderSkillBlock(block: MessageBlock): string {
  return `<div class="skill-label">Skill: ${escapeHtml(block.skill ?? "unknown")}</div>`;
}

function renderMessage(msg: ConvMessage, charts: ChartDef[]): string {
  const isUser = msg.role === "user";
  const parts: string[] = [];

  parts.push(`<div class="message ${isUser ? "user-message" : "assistant-message"}">`);
  parts.push(`<div class="message-role">${isUser ? "You" : "OpsBlaze"}</div>`);
  parts.push(`<div class="message-content">`);

  for (const block of msg.blocks) {
    switch (block.type) {
      case "text":
        parts.push(renderTextBlock(block));
        break;
      case "chart":
        parts.push(renderChartBlock(block, charts));
        break;
      case "skill":
        parts.push(renderSkillBlock(block));
        break;
    }
  }

  parts.push(`</div></div>`);
  return parts.join("\n");
}

const PALETTE = [
  "rgba(99, 102, 241, 0.8)",
  "rgba(236, 72, 153, 0.8)",
  "rgba(34, 197, 94, 0.8)",
  "rgba(245, 158, 11, 0.8)",
  "rgba(14, 165, 233, 0.8)",
  "rgba(168, 85, 247, 0.8)",
  "rgba(239, 68, 68, 0.8)",
  "rgba(20, 184, 166, 0.8)",
];

const PALETTE_BORDER = PALETTE.map((c) => c.replace("0.8)", "1)"));

function buildChartScript(charts: ChartDef[]): string {
  if (charts.length === 0) return "";

  const palette = JSON.stringify(PALETTE);
  const paletteBorder = JSON.stringify(PALETTE_BORDER);
  const chartData = JSON.stringify(charts).replace(/</g, "\\u003c");

  return `
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js" integrity="sha384-T/4KgSWuZEPozpPz7rnnp/5lDSnpY1VPJCojf1S81uTHS1E38qgLfMgVsAeRCWc4" crossorigin="anonymous"></script>
<script>
(function() {
  var palette = ${palette};
  var paletteBorder = ${paletteBorder};
  var charts = ${chartData};

  function mapType(vt) {
    if (vt === 'column' || vt === 'bar') return 'bar';
    if (vt === 'area') return 'line';
    if (vt === 'pie') return 'pie';
    return vt;
  }

  charts.forEach(function(c) {
    var ctx = document.getElementById(c.id);
    if (!ctx) return;
    var type = mapType(c.vizType);
    var isPie = type === 'pie';
    var isArea = c.vizType === 'area';
    var isHoriz = c.vizType === 'bar';

    var datasets = c.datasets.map(function(ds, i) {
      var color = palette[i % palette.length];
      var border = paletteBorder[i % paletteBorder.length];
      var cfg = {
        label: ds.label,
        data: ds.data,
        backgroundColor: isPie ? palette.slice(0, ds.data.length) : color,
        borderColor: isPie ? paletteBorder.slice(0, ds.data.length) : border,
        borderWidth: isPie ? 1 : 2,
      };
      if (isArea) { cfg.fill = true; cfg.tension = 0.3; }
      if (type === 'line' && !isArea) { cfg.fill = false; cfg.tension = 0.2; }
      return cfg;
    });

    new Chart(ctx, {
      type: type,
      data: { labels: c.labels, datasets: datasets },
      options: {
        indexAxis: isHoriz ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: isPie ? 1.4 : 2.2,
        plugins: {
          legend: {
            display: c.datasets.length > 1 || isPie,
            position: isPie ? 'right' : 'top',
            labels: { font: { size: 11 } }
          }
        },
        scales: isPie ? {} : {
          x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
          y: { ticks: { font: { size: 10 } }, beginAtZero: true }
        }
      }
    });
  });
})();
</script>`;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.6;
    color: #1a1a2e;
    background: #fff;
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 24px 80px;
  }
  .report-header {
    border-bottom: 2px solid #6366f1;
    padding-bottom: 16px;
    margin-bottom: 32px;
  }
  .report-header h1 {
    font-size: 1.5rem;
    color: #1a1a2e;
    margin-bottom: 4px;
  }
  .report-header .subtitle {
    font-size: 0.8rem;
    color: #6366f1;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .report-header .meta {
    font-size: 0.8rem;
    color: #666;
    margin-top: 8px;
  }
  .message {
    margin-bottom: 28px;
    page-break-inside: avoid;
  }
  .message-role {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
  }
  .user-message .message-role { color: #6366f1; }
  .assistant-message .message-role { color: #444; }
  .user-message .message-content {
    background: #f0f0ff;
    border-left: 3px solid #6366f1;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 0.9rem;
  }
  .assistant-message .message-content {
    font-size: 0.9rem;
  }
  .message-content h1, .message-content h2, .message-content h3 {
    margin-top: 16px;
    margin-bottom: 8px;
    color: #1a1a2e;
  }
  .message-content h2 { font-size: 1.15rem; }
  .message-content h3 { font-size: 1rem; }
  .message-content p { margin-bottom: 10px; }
  .message-content ul, .message-content ol {
    margin: 8px 0 8px 24px;
  }
  .message-content li { margin-bottom: 4px; }
  .message-content code {
    background: #f3f3f8;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 0.85em;
    font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  }
  .message-content pre {
    background: #f3f3f8;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 10px 0;
  }
  .message-content pre code {
    background: none;
    padding: 0;
  }
  .message-content strong { font-weight: 600; }
  .message-content table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 0.85rem;
  }
  .message-content th, .message-content td {
    border: 1px solid #ddd;
    padding: 6px 10px;
    text-align: left;
  }
  .message-content th {
    background: #f3f3f8;
    font-weight: 600;
  }
  .chart-block {
    margin: 16px 0;
    border: 1px solid #e0e0e8;
    border-radius: 8px;
    overflow: hidden;
  }
  .chart-canvas-wrap {
    padding: 16px;
    max-width: 800px;
    margin: 0 auto;
  }
  .single-value {
    text-align: center;
    padding: 24px 16px;
  }
  .single-value-number {
    font-size: 2.5rem;
    font-weight: 700;
    color: #6366f1;
    line-height: 1.2;
  }
  .single-value-label {
    font-size: 0.85rem;
    color: #666;
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .spl-query {
    padding: 10px 14px;
    background: #fafaff;
    border-bottom: 1px solid #e0e0e8;
  }
  .spl-query code {
    font-size: 0.8rem;
    color: #333;
    word-break: break-all;
    white-space: pre-wrap;
  }
  .spl-time {
    padding: 4px 14px 8px;
    font-size: 0.7rem;
    color: #888;
    background: #fafaff;
    border-bottom: 1px solid #e0e0e8;
  }
  .data-details {
    border-top: 1px solid #e0e0e8;
  }
  .data-details summary {
    padding: 8px 14px;
    font-size: 0.75rem;
    color: #6366f1;
    cursor: pointer;
    user-select: none;
    font-weight: 500;
  }
  .data-details summary:hover {
    background: #fafaff;
  }
  .data-table-wrap {
    overflow-x: auto;
    padding: 0 8px 8px;
  }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .data-table th, .data-table td {
    border: 1px solid #ddd;
    padding: 5px 8px;
    text-align: left;
    white-space: nowrap;
  }
  .data-table th {
    background: #f3f3f8;
    font-weight: 600;
    color: #444;
  }
  .data-table tbody tr:nth-child(even) { background: #fafaff; }
  .truncation-note {
    text-align: center;
    font-size: 0.75rem;
    color: #888;
    padding: 6px;
    font-style: italic;
  }
  .skill-label {
    display: inline-block;
    margin: 6px 0;
    padding: 3px 10px;
    border-radius: 4px;
    background: #f0f0ff;
    border: 1px solid #d0d0f0;
    font-size: 0.72rem;
    color: #6366f1;
    font-family: 'JetBrains Mono', monospace;
  }
  .report-footer {
    margin-top: 48px;
    padding-top: 16px;
    border-top: 1px solid #e0e0e8;
    font-size: 0.7rem;
    color: #999;
    text-align: center;
  }
  @media print {
    body {
      padding: 0;
      max-width: 100%;
      font-size: 10pt;
      color: #000;
    }
    .report-header {
      border-bottom-color: #333;
      margin-bottom: 20px;
    }
    .report-header .subtitle { color: #333; }
    .message { page-break-inside: avoid; margin-bottom: 16px; }
    .user-message .message-content {
      background: #f5f5f5 !important;
      border-left-color: #333;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .chart-block {
      page-break-inside: avoid;
      border-color: #999;
    }
    .chart-canvas-wrap {
      max-width: 100%;
      padding: 12px;
    }
    canvas {
      max-width: 100% !important;
      height: auto !important;
    }
    .data-details[open] summary { display: none; }
    .data-details:not([open]) { display: none; }
    .data-table th {
      background: #eee !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .data-table td, .data-table th {
      border-color: #999;
      padding: 3px 6px;
      font-size: 8pt;
    }
    .data-table tbody tr:nth-child(even) {
      background: #f5f5f5 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .spl-query code { font-size: 8pt; }
    .skill-label { border-color: #999; background: #f5f5f5 !important; color: #333; }
    .report-footer { margin-top: 24px; }
    a { color: #000; text-decoration: underline; }
  }

  @page {
    margin: 0.75in;
    size: letter;
  }
`;

export function renderExportHtml(conv: StoredConversation): string {
  chartCounter = 0;
  const charts: ChartDef[] = [];
  const messages = (conv.messages ?? []) as ConvMessage[];
  const created = new Date(conv.createdAt).toLocaleString();
  const updated = new Date(conv.updatedAt).toLocaleString();

  const body = messages.map((m) => renderMessage(m, charts)).join("\n");
  const chartScript = buildChartScript(charts);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(conv.title)} — OpsBlaze Investigation</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="report-header">
    <div class="subtitle">OpsBlaze Investigation Report</div>
    <h1>${escapeHtml(conv.title)}</h1>
    <div class="meta">Created: ${escapeHtml(created)} &middot; Last updated: ${escapeHtml(updated)}</div>
  </div>
  ${body}
  <div class="report-footer">
    Exported from OpsBlaze &middot; ${escapeHtml(new Date().toLocaleString())}
  </div>
  ${chartScript}
</body>
</html>`;
}
