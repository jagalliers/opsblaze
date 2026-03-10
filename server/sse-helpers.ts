import type { Response } from "express";

export function sendSSE(res: Response, event: string, data: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function chartHasData(ds: unknown): boolean {
  const primary = (ds as Record<string, unknown>)?.primary as Record<string, unknown> | undefined;
  const data = primary?.data as Record<string, unknown> | undefined;
  const cols = data?.columns as unknown[][] | undefined;
  return Array.isArray(cols) && cols.length > 0 && Array.isArray(cols[0]) && cols[0].length > 0;
}

const CHART_OPEN = "<chart>";
const CHART_CLOSE = "</chart>";
const CHART_OPEN_PARTIAL = "<chart";

export interface FlushTextState {
  textBuffer: string;
  inChartTag: boolean;
}

/**
 * Processes buffered text, extracting chart tags and emitting SSE events.
 * Returns the updated state after processing.
 */
export function processTextBuffer(
  state: FlushTextState,
  force: boolean,
  emit: (event: string, data: unknown) => void
): FlushTextState {
  let { textBuffer, inChartTag } = state;
  if (!textBuffer) return { textBuffer, inChartTag };

  while (true) {
    const openIdx = textBuffer.indexOf(CHART_OPEN);
    if (openIdx === -1) {
      if (inChartTag) break;

      if (!force) {
        const partialIdx = textBuffer.lastIndexOf("<");
        if (partialIdx !== -1 && textBuffer.slice(partialIdx).length < CHART_OPEN.length) {
          const candidate = textBuffer.slice(partialIdx);
          if (CHART_OPEN_PARTIAL.startsWith(candidate)) {
            if (partialIdx > 0) {
              emit("text", { content: textBuffer.slice(0, partialIdx) });
            }
            textBuffer = textBuffer.slice(partialIdx);
            return { textBuffer, inChartTag };
          }
        }
      }

      emit("text", { content: textBuffer });
      textBuffer = "";
      break;
    }

    if (openIdx > 0 && !inChartTag) {
      emit("text", { content: textBuffer.slice(0, openIdx) });
    }

    const closeIdx = textBuffer.indexOf(CHART_CLOSE, openIdx);
    if (closeIdx === -1) {
      inChartTag = true;
      textBuffer = textBuffer.slice(openIdx);
      break;
    }

    const chartJson = textBuffer.slice(openIdx + CHART_OPEN.length, closeIdx);
    try {
      const chartData = JSON.parse(chartJson);
      if (chartHasData(chartData.dataSources)) {
        emit("chart", chartData);
      }
    } catch {
      // Malformed chart JSON — drop silently
    }

    textBuffer = textBuffer.slice(closeIdx + CHART_CLOSE.length);
    inChartTag = false;
  }

  return { textBuffer, inChartTag };
}
