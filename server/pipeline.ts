import type { Logger } from "pino";
import { chartHasData, processTextBuffer } from "./sse-helpers.js";
import type { FlushTextState } from "./sse-helpers.js";

interface SplunkToolResult {
  summary: string;
  chart: {
    vizType: string;
    dataSources: unknown;
    width: number;
    height: number;
  } | null;
  suppressed: boolean;
  queryMeta?: { spl: string; earliest: string; latest: string };
}

export interface PipelineEmitter {
  emit: (event: string, data: unknown) => void;
  log: Logger;
}

const MAX_TOOL_INPUT_BYTES = 1_048_576; // 1 MB

function handleToolResult(text: string, emitter: PipelineEmitter): void {
  try {
    const result = JSON.parse(text) as SplunkToolResult;
    if (result.chart && !result.suppressed && chartHasData(result.chart.dataSources)) {
      emitter.log.debug({ vizType: result.chart.vizType }, "emitting chart event");
      emitter.emit("chart", {
        vizType: result.chart.vizType,
        dataSources: result.chart.dataSources,
        width: result.chart.width,
        height: result.chart.height,
        spl: result.queryMeta?.spl,
        earliest: result.queryMeta?.earliest,
        latest: result.queryMeta?.latest,
      });
    }
  } catch {
    // Not a SplunkToolResult JSON — ignore
  }
}

function extractToolResultText(value: unknown, emitter: PipelineEmitter): void {
  if (Array.isArray(value)) {
    for (const part of value) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as Record<string, unknown>).type === "text" &&
        typeof (part as Record<string, unknown>).text === "string"
      ) {
        handleToolResult((part as Record<string, unknown>).text as string, emitter);
      }
    }
  } else if (typeof value === "string") {
    handleToolResult(value, emitter);
  }
}

/**
 * Processes a stream of Claude Agent SDK messages, emitting SSE events
 * via the provided emitter. This is the core pipeline logic extracted
 * from runAgent() for testability and recording/replay support.
 */
export async function processMessageStream(
  messages: AsyncIterable<Record<string, unknown>>,
  emitter: PipelineEmitter,
  abortSignal?: AbortSignal,
  deniedSkills?: Set<string>
): Promise<{ turnCount: number; skillsUsed: string[] }> {
  let turnCount = 0;
  let inTool = false;
  let currentToolName = "";
  let toolInputBuf = "";
  let bufState: FlushTextState = { textBuffer: "", inChartTag: false };
  const skillsUsed: string[] = [];
  const pendingSkills: string[] = [];

  function flushText(force = false) {
    bufState = processTextBuffer(bufState, force, emitter.emit);
  }

  try {
    for await (const message of messages) {
      if (abortSignal?.aborted) break;

      if (message.type === "stream_event") {
        const event = message.event as Record<string, unknown>;

        if (event.type === "content_block_start") {
          const contentBlock = event.content_block as Record<string, unknown>;
          if (contentBlock.type === "tool_use") {
            inTool = true;
            currentToolName = (contentBlock.name as string) ?? "";
            toolInputBuf = "";
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown>;
          if (delta.type === "text_delta" && !inTool) {
            bufState.textBuffer += delta.text as string;
            if (bufState.inChartTag) {
              if (bufState.textBuffer.includes("</chart>")) flushText();
            } else if (bufState.textBuffer.includes("<chart")) {
              if (bufState.textBuffer.includes("</chart>")) flushText();
            } else {
              flushText();
            }
          } else if (delta.type === "input_json_delta" && inTool) {
            const chunk = (delta.partial_json as string) ?? "";
            if (toolInputBuf.length + chunk.length <= MAX_TOOL_INPUT_BYTES) {
              toolInputBuf += chunk;
            } else if (toolInputBuf.length < MAX_TOOL_INPUT_BYTES) {
              emitter.log.warn(
                { currentToolName, bytes: toolInputBuf.length + chunk.length },
                "tool input exceeded 1 MB limit, truncating"
              );
              toolInputBuf += chunk.slice(0, MAX_TOOL_INPUT_BYTES - toolInputBuf.length);
            }
          }
        } else if (event.type === "content_block_stop") {
          if (inTool) {
            if (currentToolName === "Skill" && toolInputBuf) {
              try {
                const input = JSON.parse(toolInputBuf) as Record<string, unknown>;
                const skillName =
                  ((input.skill ?? input.skill_name ?? input.name) as string) || "unknown";
                skillsUsed.push(skillName);
                emitter.log.debug({ skill: skillName }, "model invoked skill");
                if (deniedSkills) {
                  pendingSkills.push(skillName);
                } else {
                  emitter.emit("skill", { skill: skillName });
                }
              } catch {
                skillsUsed.push("unknown");
                emitter.log.debug(
                  { inputLen: toolInputBuf.length },
                  "model invoked skill (unparseable input)"
                );
              }
            }
            inTool = false;
            currentToolName = "";
            toolInputBuf = "";
          } else {
            flushText(true);
          }
        }
      }

      if (message.type === "system") {
        const subtype = (message as Record<string, unknown>).subtype as string | undefined;
        if (subtype === "hook_response") {
          const hookEvent = (message as Record<string, unknown>).hook_event as string | undefined;
          if (hookEvent === "PreToolUse" && pendingSkills.length > 0) {
            const skill = pendingSkills.shift()!;
            if (deniedSkills?.has(skill)) {
              emitter.log.debug({ skill }, "suppressed skill indicator (denied by hook)");
            } else {
              emitter.emit("skill", { skill });
            }
          }
        }
      }

      if (message.type === "user") {
        // Drain pending skills at turn boundary — hooks have already executed
        // by this point, so deniedSkills is fully populated. This handles SDKs
        // that don't emit hook_response system messages (e.g. bypassPermissions).
        while (pendingSkills.length > 0) {
          const skill = pendingSkills.shift()!;
          if (deniedSkills?.has(skill)) {
            emitter.log.debug({ skill }, "suppressed skill indicator (denied by hook)");
          } else {
            emitter.emit("skill", { skill });
          }
        }
        turnCount++;
        if (message.message && typeof message.message === "object") {
          const inner = message.message as Record<string, unknown>;
          if (Array.isArray(inner.content)) {
            for (const block of inner.content as Array<Record<string, unknown>>) {
              if (block.type === "tool_result") {
                extractToolResultText(block.content, emitter);
              }
            }
          }
        }
        emitter.emit("text", { content: "\n\n" });
      }

      if (message.type === "result") {
        flushText(true);
        if (message.subtype === "error_during_execution") {
          const errorText =
            typeof message.result === "string" ? message.result : "Agent execution error";
          emitter.log.error({ errorText }, "agent execution error");
          emitter.emit("error", { message: errorText });
        }
      }
    }

    flushText(true);

    for (const skill of pendingSkills) {
      if (!deniedSkills?.has(skill)) {
        emitter.emit("skill", { skill });
      }
    }
    pendingSkills.length = 0;
  } catch (err) {
    if (!abortSignal?.aborted) {
      emitter.log.error({ err }, "agent error");
      emitter.emit("error", { message: "An error occurred during the investigation" });
    }
  }

  return { turnCount, skillsUsed };
}
