import type { Response } from "express";
import type { Logger } from "pino";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import { logger as rootLogger } from "./logger.js";
import { sendSSE } from "./sse-helpers.js";
import { processMessageStream } from "./pipeline.js";
import { buildMcpServersForQuery } from "./mcp-config.js";
import { listSkills } from "./skills.js";
import { getClaudeModel, getClaudeEffort } from "./runtime-settings.js";

const PROJECT_ROOT = process.cwd();

interface HistoryMessage {
  role: string;
  content: string;
}

function extractSkillName(toolInput: Record<string, unknown>): string | null {
  const name =
    (toolInput.skill as string) ??
    (toolInput.skill_name as string) ??
    (toolInput.name as string) ??
    null;
  return typeof name === "string" ? name : null;
}

function buildSkillScopeHook(
  allowedSkills: string[],
  deniedSkills: Set<string>,
  log: Logger
): HookCallback {
  const allowed = new Set(allowedSkills);
  return async (input, _toolUseID, _opts) => {
    const preInput = input as PreToolUseHookInput;
    const toolInput = preInput.tool_input as Record<string, unknown>;
    const skillName = extractSkillName(toolInput);

    if (skillName === null) {
      log.warn(
        { inputLen: JSON.stringify(toolInput).length },
        "Skill tool invoked but no skill name found in input"
      );
      return {};
    }

    if (allowed.has(skillName)) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
          permissionDecisionReason: "Skill is in the allowed set for this request",
        },
      };
    }

    deniedSkills.add(skillName);
    log.debug({ skill: skillName, allowed: allowedSkills }, "skill blocked by scope hook");
    return {
      systemMessage: `Skill '${skillName}' is not available for this request. Only use: ${allowedSkills.join(", ")}`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: `Skill '${skillName}' is not enabled for this request. Available: ${allowedSkills.join(", ")}`,
      },
    };
  };
}

function buildSkillDirective(allowedSkills: string[]): string {
  return `For this request, only use the following skill(s): ${allowedSkills.join(", ")}. Do not invoke any other skills.`;
}

function buildPrompt(userMessage: string, history: HistoryMessage[]): string {
  if (history.length === 0) return userMessage;

  const contextLines = history.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant";
    return `${role}: ${m.content}`;
  });

  return "Previous conversation:\n" + contextLines.join("\n\n") + "\n\n---\n\nUser: " + userMessage;
}

export async function runAgent(
  userMessage: string,
  history: HistoryMessage[],
  res: Response,
  abortSignal?: AbortSignal,
  log?: Logger,
  requestedSkills?: string[]
): Promise<void> {
  const agentLog = log ?? rootLogger;
  const prompt = buildPrompt(userMessage, history);

  const abortController = new AbortController();
  if (abortSignal) {
    abortSignal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
  }

  const model = await getClaudeModel();
  const effort = await getClaudeEffort();

  const { mcpServers, allowedTools } = await buildMcpServersForQuery();
  agentLog.debug(
    { serverCount: Object.keys(mcpServers).length, tools: allowedTools },
    "MCP servers loaded for query"
  );

  const skills = await listSkills();
  const activeSkills = skills.filter((s) => s.enabled).map((s) => s.name);
  const disabledSkills = skills.filter((s) => !s.enabled).map((s) => s.name);
  agentLog.debug(
    {
      discovered: skills.length,
      active: activeSkills,
      disabled: disabledSkills.length > 0 ? disabledSkills : undefined,
      ...(requestedSkills && { scopedTo: requestedSkills }),
    },
    "skills for query"
  );

  const queryOptions: Record<string, any> = {
    cwd: PROJECT_ROOT,
    model,
    effort,
    settingSources: ["project"],
    allowedTools,
    mcpServers,
    includePartialMessages: true,
    permissionMode: "bypassPermissions",
    abortController,
    maxTurns: parseInt(process.env.OPSBLAZE_MAX_TURNS ?? "30", 10),
  };

  let deniedSkills: Set<string> | undefined;

  if (requestedSkills && requestedSkills.length > 0) {
    deniedSkills = new Set<string>();
    queryOptions.hooks = {
      PreToolUse: [
        { matcher: "Skill", hooks: [buildSkillScopeHook(requestedSkills, deniedSkills, agentLog)] },
      ],
    };
    queryOptions.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: buildSkillDirective(requestedSkills),
    };
    agentLog.debug({ skills: requestedSkills }, "skill scoping active");
  }

  const messageSource = query({
    prompt,
    options: queryOptions,
  }) as AsyncIterable<Record<string, unknown>>;

  let messages: AsyncIterable<Record<string, unknown>> = messageSource;

  const recordDir = process.env.OPSBLAZE_RECORD_DIR;
  if (recordDir) {
    const { recordMessages } = await import("./recorder.js");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bindings = agentLog.bindings?.() ?? {};
    const requestId = (bindings as Record<string, unknown>).requestId ?? "unknown";
    const shortId = String(requestId).slice(0, 8);
    const fixturePath = path.join(recordDir, `${timestamp}_${shortId}.jsonl`);
    agentLog.info({ fixturePath }, "recording SDK messages");
    messages = recordMessages(messageSource, fixturePath);
  }

  const emitter = {
    emit: (event: string, data: unknown) => sendSSE(res, event, data),
    log: agentLog,
  };

  const { turnCount, skillsUsed } = await processMessageStream(
    messages,
    emitter,
    abortSignal,
    deniedSkills
  );

  agentLog.info(
    {
      turns: turnCount,
      skillsUsed: skillsUsed.length > 0 ? skillsUsed : undefined,
    },
    "agent run complete"
  );
  sendSSE(res, "done", {});
}
