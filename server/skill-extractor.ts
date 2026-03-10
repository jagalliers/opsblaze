import { query } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "./logger.js";
import { getClaudeModel, getClaudeEffort } from "./runtime-settings.js";

const PROJECT_ROOT = process.cwd();

export interface SkillDraft {
  name: string;
  description: string;
  content: string;
}

interface ConversationMessage {
  role: string;
  blocks: Array<{
    type: string;
    content?: string;
    vizType?: string;
    spl?: string;
  }>;
}

function flattenConversation(messages: ConversationMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : "Assistant";
    const parts: string[] = [];

    for (const block of msg.blocks ?? []) {
      if (block.type === "text" && block.content) {
        parts.push(block.content);
      } else if (block.type === "chart") {
        const spl = block.spl ? ` — SPL: ${block.spl}` : "";
        parts.push(`[Chart: ${block.vizType ?? "unknown"}${spl}]`);
      }
    }

    if (parts.length > 0) {
      lines.push(`${role}:\n${parts.join("\n")}`);
    }
  }

  return lines.join("\n\n---\n\n");
}

const EXTRACTION_PROMPT = `You are a skill architect. Analyze the session transcript below and distill it into a reusable Claude Skill (a SKILL.md file).

A Claude Skill is a behavioral directive — imperative instructions that shape how an AI agent approaches similar problems in the future. It is NOT a summary of what happened. It IS a methodology document that tells the agent how to think and act when facing this class of problem.

## What to extract

1. **Analytical methodology** — What investigative framework was applied? What sequence of steps produced insight? What was the logical progression from broad to specific?

2. **Domain heuristics** — What domain-specific knowledge was applied? What rules of thumb proved useful? Distinguish between well-known/standard data sources (include by name) and environment-specific sources (describe by type, not name).

3. **Query and tool patterns** — What query construction *strategies* produced insight? Express as reusable patterns with placeholders for environment-specific values, not verbatim queries from the session. Focus on the approach: "aggregate by the dimension of interest and filter for outliers" rather than copying a specific query.

4. **Visualization strategy** — What chart types mapped to what analytical intents? What presentation choices made the narrative compelling?

5. **Pitfalls and guardrails** — What dead ends were encountered? What assumptions proved wrong? What should the agent avoid or watch out for?

## What NOT to include

- Specific data values, IP addresses, usernames, hostnames, or timestamps from this session
- Verbatim queries from the session — extract the pattern and strategy, not the literal syntax
- Hardcoded thresholds or time ranges — express as tunable parameters with calibration guidance (e.g., "set based on your environment's baseline volume" not "use count > 5")
- Environment-specific index names, sourcetypes, or lookup tables — describe the type of data source to look for rather than hardcoding names
- One-time findings that do not generalize
- Session-specific context that will not apply to future investigations
- Declarative summaries ("we discovered X") — instead express as imperative methodology ("when investigating X, do Y")

## Conciseness

Claude already knows most things. Only include information Claude does NOT already have — domain-specific conventions, non-obvious workflows, project-specific field semantics. Challenge each paragraph: does it justify its token cost? Remove explanations of concepts Claude already understands.

## Writing style

- Use imperative voice ("When investigating X, do Y") but explain WHY each step matters rather than rigid ALWAYS/NEVER rules
- For heuristic approaches, give general direction and trust Claude to adapt to specifics
- For fragile or exact operations, provide specific commands or scripts
- Include 1-2 concrete input/output examples where they clarify expected behavior
- Keep the skill general enough to apply across environments, not overfit to this session

## Length

Keep the body under 500 lines. If the methodology warrants more detail, add an "Additional references" section suggesting what supplementary files could be created (e.g., "For detailed query patterns, see references/query-patterns.md") — but generate only the SKILL.md itself.

## Output format

Produce the COMPLETE skill file content. Start with YAML frontmatter, then the skill body in markdown:

\`\`\`
---
name: <kebab-case-name using gerund form, e.g. investigating-login-anomalies, analyzing-network-traffic. Lowercase letters, numbers, hyphens only. Max 64 chars. Avoid vague names like "helper" or "utils".>
description: <1-2 sentences in THIRD PERSON describing what this skill does AND when to use it. Include specific trigger terms and related contexts even if not named in the session. Example: "Investigates login anomalies and authentication patterns in Splunk. Use when analyzing user access, login failures, authentication activity, session behavior, or any security-related access questions." Max 1024 chars.>
---

# <Skill Title>

<Body: imperative instructions organized with markdown headings and bullet points.>
\`\`\`

## Session transcript

`;

const REFINEMENT_PROMPT = `You are a skill architect refining a Claude Skill draft. A Claude Skill is a behavioral directive — imperative instructions that shape how an AI agent approaches similar problems in the future.

You will receive:
1. The current skill draft
2. A refinement instruction from the user
3. A summary of the original conversation (for context)

Apply the refinement instruction to improve the skill. Also check for these quality issues and fix any you find:
- Description must be in THIRD PERSON, describe what it does AND when to use it, and include trigger terms for related contexts (max 1024 chars)
- Remove anything Claude already knows — only include domain-specific or non-obvious knowledge
- Replace any verbatim queries, hardcoded thresholds, or environment-specific names with reusable patterns and placeholders
- Explain WHY steps matter rather than using rigid ALWAYS/NEVER rules
- Keep under 500 lines

Output the COMPLETE updated skill file content (YAML frontmatter with name + description, then body). Do not explain your changes — just output the updated skill.

`;

export function parseSkillDraft(raw: string): SkillDraft {
  let skillContent = raw;

  // The model may wrap output in code fences (```markdown ... ```),
  // sometimes with a stray --- before the fence. Detect and strip.
  const fencePattern = /^[\s-]*```(?:markdown|md)?\n/;
  if (fencePattern.test(skillContent)) {
    skillContent = skillContent.replace(fencePattern, "");
    skillContent = skillContent.replace(/\n```\s*$/, "");
  }

  const contentStart = skillContent.indexOf("---");
  if (contentStart > 0) {
    skillContent = skillContent.slice(contentStart);
  }

  let name = "untitled-skill";
  let description = "";
  const fmMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      if (line.startsWith("name:")) {
        name = line
          .slice("name:".length)
          .trim()
          .replace(/^["']|["']$/g, "");
      } else if (line.startsWith("description:")) {
        description = line
          .slice("description:".length)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    }
  }

  name =
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "untitled-skill";

  return { name, description, content: skillContent };
}

class AbortedError extends Error {
  constructor() {
    super("Aborted");
    this.name = "AbortedError";
  }
}

async function collectText(prompt: string, signal?: AbortSignal): Promise<string> {
  const model = await getClaudeModel();
  const effort = await getClaudeEffort();

  if (signal?.aborted) throw new AbortedError();

  const messageSource = query({
    prompt,
    options: {
      cwd: PROJECT_ROOT,
      model,
      effort,
      settingSources: [],
      tools: [],
      allowedTools: [],
      mcpServers: {},
      maxTurns: 1,
      permissionMode: "bypassPermissions",
    },
  }) as AsyncIterable<Record<string, unknown>>;

  let streamedText = "";
  let assistantText = "";

  for await (const message of messageSource) {
    if (signal?.aborted) {
      logger.info("skill extraction aborted by client");
      throw new AbortedError();
    }

    if (message.type === "stream_event") {
      const event = message.event as Record<string, unknown>;
      if (event.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === "text_delta") {
          streamedText += delta.text as string;
        }
      }
    }

    // The SDK emits a final "assistant" message with the complete content.
    // With extended thinking, text_delta stream events may not fire (only
    // thinking_delta), so the assistant message is the authoritative source.
    if (message.type === "assistant") {
      const parts: string[] = [];
      const msg = message.message as Record<string, unknown> | undefined;
      const content =
        (msg && Array.isArray(msg.content) ? msg.content : null) ??
        (Array.isArray((message as Record<string, unknown>).content)
          ? (message as Record<string, unknown>).content
          : null);

      if (content) {
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === "text" && typeof block.text === "string") {
            parts.push(block.text);
          }
        }
      }
      if (parts.length > 0) {
        assistantText = parts.join("");
      }
    }

    if (message.type === "result") {
      if (message.subtype === "error_during_execution") {
        const errorText =
          typeof message.result === "string" ? message.result : "Skill extraction failed";
        throw new Error(errorText);
      }
    }
  }

  const fullText = assistantText || streamedText;

  if (!fullText) {
    throw new Error("Skill extraction produced no output — the model returned empty text");
  }

  return fullText;
}

export async function extractSkill(
  messages: ConversationMessage[],
  signal?: AbortSignal
): Promise<SkillDraft> {
  const transcript = flattenConversation(messages);
  const prompt = EXTRACTION_PROMPT + transcript;

  logger.info({ transcriptLen: transcript.length }, "extracting skill from conversation");

  const raw = await collectText(prompt, signal);
  const draft = parseSkillDraft(raw);

  logger.info({ name: draft.name, contentLen: draft.content.length }, "skill extraction complete");

  return draft;
}

export async function refineSkill(
  currentDraft: string,
  instruction: string,
  conversationSummary: string,
  signal?: AbortSignal
): Promise<SkillDraft> {
  const prompt =
    REFINEMENT_PROMPT +
    `## Current skill draft\n\n${currentDraft}\n\n` +
    `## Refinement instruction\n\n${instruction}\n\n` +
    `## Original conversation summary\n\n${conversationSummary}\n`;

  logger.info({ instructionLen: instruction.length }, "refining skill draft");

  const raw = await collectText(prompt, signal);
  const draft = parseSkillDraft(raw);

  logger.info({ name: draft.name, contentLen: draft.content.length }, "skill refinement complete");

  return draft;
}
