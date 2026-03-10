import "dotenv/config";
import crypto from "crypto";
import fs from "fs";

import net from "net";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import type { Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { logger } from "./logger.js";
import { validateEnv } from "./env.js";
import { runAgent } from "./agent.js";
import { classifyAgentError } from "./pipeline.js";
import {
  listConversations,
  getConversation,
  saveConversation,
  deleteConversation,
  cleanupConversations,
  searchConversations,
} from "./conversations.js";
import type { StoredConversation } from "./conversations.js";
import {
  listMcpServers,
  getMcpServer,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  toggleMcpServer,
  MCP_CONFIG_PATH,
} from "./mcp-config.js";
import type { McpServerEntry } from "./mcp-config.js";
import { probeMcpServer } from "./mcp-probe.js";
import {
  listSkills,
  toggleSkill,
  createSkill,
  deleteSkill,
  validateSkillsParam,
  SKILLS_DIR_PATH,
} from "./skills.js";
import { extractSkill, refineSkill } from "./skill-extractor.js";
import { renderExportHtml } from "./export.js";
import { runHealthChecks } from "./health.js";
import { updateRuntimeSettings, getClaudeModel, getClaudeEffort } from "./runtime-settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const STREAM_TIMEOUT_MS = parseInt(process.env.OPSBLAZE_STREAM_TIMEOUT_MS ?? "300000", 10);
const MAX_HISTORY = parseInt(process.env.OPSBLAZE_MAX_HISTORY ?? "20", 10);
const MAX_MESSAGE_LEN = parseInt(process.env.OPSBLAZE_MAX_MESSAGE_LEN ?? "10000", 10);
const MAX_HISTORY_ENTRY_LEN = 50_000;
const MAX_MESSAGES_PER_CONVERSATION = 500;
const MAX_SKILL_CONTENT_LEN = 100_000;
const MAX_SEARCH_LEN = 500;
const MIN_CLEANUP_DAYS = 1;

const KNOWN_VALIDATION_PATTERNS = [
  "already exists",
  "built-in",
  "not found",
  "not allowed",
  "requires a",
  "must be",
  "Unknown server type",
  "no SKILL.md",
  "alphanumeric",
  "reserved words",
  "description",
  "blocked for security",
];

function safeErrorMessage(err: unknown): string | null {
  const msg = (err as Error).message ?? "";
  if (KNOWN_VALIDATION_PATTERNS.some((p) => msg.includes(p))) {
    return msg.slice(0, 200);
  }
  return null;
}

const MCP_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function validateMcpName(name: string, res: Response): boolean {
  if (!name || name.length > 64 || !MCP_NAME_RE.test(name)) {
    res
      .status(400)
      .json({ error: "name must be 1-64 alphanumeric characters with hyphens/underscores" });
    return false;
  }
  return true;
}

function validateMessages(messages: unknown): messages is Array<unknown> {
  if (!Array.isArray(messages)) return false;
  if (messages.length > MAX_MESSAGES_PER_CONVERSATION) return false;
  return true;
}

const app = express();

const allowedOrigins = (
  process.env.OPSBLAZE_ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:3000"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "2mb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: parseInt(process.env.OPSBLAZE_RATE_LIMIT ?? "10", 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const activeConnections = new Set<{
  res: Response;
  abort: AbortController;
}>();

app.post("/api/chat", chatLimiter, async (req, res) => {
  const requestId = crypto.randomUUID();
  const reqLog = logger.child({ requestId });

  const {
    message,
    history: rawHistory,
    skills: rawSkills,
  } = req.body as {
    message: string;
    history?: Array<{ role: string; content: string }>;
    skills?: string[];
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (message.length > MAX_MESSAGE_LEN) {
    res.status(400).json({ error: `message exceeds ${MAX_MESSAGE_LEN} character limit` });
    return;
  }

  const fullLen = rawHistory?.length ?? 0;
  const VALID_ROLES = new Set(["user", "assistant"]);
  const history = (rawHistory ?? [])
    .filter((entry) => VALID_ROLES.has(entry.role))
    .slice(-MAX_HISTORY)
    .map((entry) => ({
      role: entry.role as "user" | "assistant",
      content:
        typeof entry.content === "string" && entry.content.length > MAX_HISTORY_ENTRY_LEN
          ? entry.content.slice(0, MAX_HISTORY_ENTRY_LEN)
          : (entry.content ?? ""),
    }));
  if (fullLen > MAX_HISTORY) {
    reqLog.warn({ fullLen, kept: MAX_HISTORY }, "history truncated to max exchanges");
  }

  const skillResult = await validateSkillsParam(rawSkills);
  if ("error" in skillResult) {
    res.status(400).json({ error: skillResult.error });
    return;
  }
  const requestedSkills = skillResult.skills;

  reqLog.info(
    {
      messageLen: message.length,
      historyLen: history.length,
      ...(requestedSkills && { skills: requestedSkills }),
    },
    "chat request received"
  );

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const abortController = new AbortController();
  const conn = { res, abort: abortController };
  activeConnections.add(conn);

  res.on("close", () => {
    activeConnections.delete(conn);
    if (!res.writableFinished) {
      abortController.abort();
    }
  });

  const streamTimeout = setTimeout(() => {
    reqLog.error("stream timeout reached, aborting agent");
    abortController.abort();
  }, STREAM_TIMEOUT_MS);

  try {
    await runAgent(message, history, res, abortController.signal, reqLog, requestedSkills);
  } catch (err) {
    if (!abortController.signal.aborted && !res.writableEnded && !res.destroyed) {
      reqLog.error({ err }, "chat error");
      const userMessage = classifyAgentError(err);
      res.write(`event: error\ndata: ${JSON.stringify({ message: userMessage })}\n\n`);
      res.write(`event: done\ndata: {}\n\n`);
    }
  } finally {
    clearTimeout(streamTimeout);
    activeConnections.delete(conn);
  }

  reqLog.info("chat request complete");
  res.end();
});

app.get("/api/conversations", apiLimiter, async (_req, res) => {
  try {
    const conversations = await listConversations();
    res.json(conversations);
  } catch (err) {
    logger.error({ err }, "failed to list conversations");
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

app.get("/api/conversations/search", apiLimiter, async (req, res) => {
  try {
    const q = ((req.query.q as string) ?? "").trim();
    if (!q) {
      res.json([]);
      return;
    }
    if (q.length > MAX_SEARCH_LEN) {
      res.status(400).json({ error: `search query exceeds ${MAX_SEARCH_LEN} character limit` });
      return;
    }
    const results = await searchConversations(q);
    res.json(results);
  } catch (err) {
    logger.error({ err }, "failed to search conversations");
    res.status(500).json({ error: "Failed to search conversations" });
  }
});

app.get("/api/conversations/:id", apiLimiter, async (req, res) => {
  try {
    const conv = await getConversation(req.params.id as string);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(conv);
  } catch (err) {
    logger.error({ err, id: req.params.id }, "failed to get conversation");
    res.status(500).json({ error: "Failed to load conversation" });
  }
});

app.post("/api/conversations", apiLimiter, async (req, res) => {
  try {
    const { id, title, messages } = req.body as Partial<StoredConversation>;
    if (!id || !title) {
      res.status(400).json({ error: "id and title are required" });
      return;
    }
    if (id.length > 128) {
      res.status(400).json({ error: "id exceeds 128 character limit" });
      return;
    }
    if (title.length > 256) {
      res.status(400).json({ error: "title exceeds 256 character limit" });
      return;
    }
    if (messages !== undefined && !validateMessages(messages)) {
      res.status(400).json({
        error: `messages must be an array with at most ${MAX_MESSAGES_PER_CONVERSATION} entries`,
      });
      return;
    }
    const now = new Date().toISOString();
    const conv: StoredConversation = {
      id,
      title,
      messages: (messages as StoredConversation["messages"]) ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await saveConversation(conv);
    res.status(201).json(conv);
  } catch (err) {
    logger.error({ err }, "failed to create conversation");
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

app.put("/api/conversations/:id", apiLimiter, async (req, res) => {
  try {
    const existing = await getConversation(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const { title, messages } = req.body as Partial<StoredConversation>;
    if (messages !== undefined && !validateMessages(messages)) {
      res.status(400).json({
        error: `messages must be an array with at most ${MAX_MESSAGES_PER_CONVERSATION} entries`,
      });
      return;
    }
    const updated: StoredConversation = {
      ...existing,
      title: title ?? existing.title,
      messages: (messages as StoredConversation["messages"]) ?? existing.messages,
      updatedAt: new Date().toISOString(),
    };
    await saveConversation(updated);
    res.json(updated);
  } catch (err) {
    logger.error({ err, id: req.params.id }, "failed to update conversation");
    res.status(500).json({ error: "Failed to update conversation" });
  }
});

app.delete("/api/conversations/:id", apiLimiter, async (req, res) => {
  try {
    const deleted = await deleteConversation(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id: req.params.id }, "failed to delete conversation");
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

app.get("/api/conversations/:id/export", apiLimiter, async (req, res) => {
  try {
    const conv = await getConversation(req.params.id as string);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const html = renderExportHtml(conv);
    const safeTitle = conv.title
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="investigation-${safeTitle}.html"`);
    res.send(html);
  } catch (err) {
    logger.error({ err, id: req.params.id }, "failed to export conversation");
    res.status(500).json({ error: "Failed to export conversation" });
  }
});

app.post("/api/conversations/cleanup", apiLimiter, async (req, res) => {
  try {
    const { maxAgeDays } = req.body as { maxAgeDays?: number };
    const days = maxAgeDays && maxAgeDays >= MIN_CLEANUP_DAYS ? maxAgeDays : 90;
    const deleted = await cleanupConversations(days);
    res.json({ deleted, maxAgeDays: days });
  } catch (err) {
    logger.error({ err }, "failed to cleanup conversations");
    res.status(500).json({ error: "Failed to cleanup conversations" });
  }
});

// --- Config paths ---

app.get("/api/config-paths", apiLimiter, (_req, res) => {
  res.json({ mcpConfig: MCP_CONFIG_PATH, skillsDir: SKILLS_DIR_PATH });
});

// --- Runtime settings routes ---

app.get("/api/settings", apiLimiter, async (_req, res) => {
  try {
    const [model, effort] = await Promise.all([getClaudeModel(), getClaudeEffort()]);
    res.json({
      runtime: { claudeModel: model, claudeEffort: effort },
      system: {
        splunkHost: process.env.SPLUNK_HOST ?? "",
        splunkPort: parseInt(process.env.SPLUNK_PORT ?? "8089", 10),
        splunkScheme: process.env.SPLUNK_SCHEME ?? "https",
        splunkAuthMethod: process.env.SPLUNK_TOKEN ? "Token" : "Basic",
        serverPort: PORT,
        bindAddress: HOST,
        claudeAuthMethod: process.env.ANTHROPIC_API_KEY ? "API Key" : "CLI",
        serverMode: process.env.NODE_ENV === "production" ? "Prod" : "Dev",
      },
    });
  } catch (err) {
    logger.error({ err }, "failed to get settings");
    res.status(500).json({ error: "Failed to get settings" });
  }
});

app.patch("/api/settings", apiLimiter, async (req, res) => {
  try {
    await updateRuntimeSettings(req.body);
    const [model, effort] = await Promise.all([getClaudeModel(), getClaudeEffort()]);
    res.json({
      runtime: { claudeModel: model, claudeEffort: effort },
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Expected") || msg.includes("invalid")) {
      res.status(400).json({ error: msg });
    } else {
      logger.error({ err }, "failed to update settings");
      res.status(500).json({ error: "Failed to update settings" });
    }
  }
});

// --- MCP Server management routes ---

app.get("/api/mcp-servers", apiLimiter, async (_req, res) => {
  try {
    const servers = await listMcpServers();
    res.json(servers);
  } catch (err) {
    logger.error({ err }, "failed to list MCP servers");
    res.status(500).json({ error: "Failed to list MCP servers" });
  }
});

app.post("/api/mcp-servers", apiLimiter, async (req, res) => {
  try {
    const { name, config } = req.body as { name: string; config: McpServerEntry };
    if (!name || !config) {
      res.status(400).json({ error: "name and config are required" });
      return;
    }
    if (!validateMcpName(name, res)) return;
    await addMcpServer(name, config);
    res.status(201).json({ ok: true });
  } catch (err) {
    const safe = safeErrorMessage(err);
    if (safe && (safe.includes("already exists") || safe.includes("built-in"))) {
      res.status(409).json({ error: safe });
    } else if (safe) {
      res.status(400).json({ error: safe });
    } else {
      logger.error({ err }, "failed to add MCP server");
      res.status(500).json({ error: "Failed to add MCP server" });
    }
  }
});

app.put("/api/mcp-servers/:name", apiLimiter, async (req, res) => {
  try {
    const name = req.params.name as string;
    if (!validateMcpName(name, res)) return;
    const config = req.body as McpServerEntry;
    await updateMcpServer(name, config);
    res.json({ ok: true });
  } catch (err) {
    const safe = safeErrorMessage(err);
    if (safe?.includes("not found")) {
      res.status(404).json({ error: "MCP server not found" });
    } else if (safe?.includes("built-in")) {
      res.status(403).json({ error: "Cannot modify built-in server" });
    } else if (safe) {
      res.status(400).json({ error: safe });
    } else {
      logger.error({ err, name: req.params.name }, "failed to update MCP server");
      res.status(500).json({ error: "Failed to update MCP server" });
    }
  }
});

app.delete("/api/mcp-servers/:name", apiLimiter, async (req, res) => {
  try {
    if (!validateMcpName(req.params.name as string, res)) return;
    await deleteMcpServer(req.params.name as string);
    res.json({ ok: true });
  } catch (err) {
    const safe = safeErrorMessage(err);
    if (safe?.includes("not found")) {
      res.status(404).json({ error: "MCP server not found" });
    } else if (safe?.includes("built-in")) {
      res.status(403).json({ error: "Cannot modify built-in server" });
    } else {
      logger.error({ err, name: req.params.name }, "failed to delete MCP server");
      res.status(500).json({ error: "Failed to delete MCP server" });
    }
  }
});

app.post("/api/mcp-servers/:name/toggle", apiLimiter, async (req, res) => {
  try {
    if (!validateMcpName(req.params.name as string, res)) return;
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }
    await toggleMcpServer(req.params.name as string, enabled);
    res.json({ ok: true });
  } catch (err) {
    const safe = safeErrorMessage(err);
    if (safe?.includes("not found")) {
      res.status(404).json({ error: "MCP server not found" });
    } else if (safe?.includes("built-in")) {
      res.status(403).json({ error: "Cannot modify built-in server" });
    } else {
      logger.error({ err, name: req.params.name }, "failed to toggle MCP server");
      res.status(500).json({ error: "Failed to toggle MCP server" });
    }
  }
});

app.post("/api/mcp-servers/:name/test", apiLimiter, async (req, res) => {
  try {
    if (!validateMcpName(req.params.name as string, res)) return;
    const server = await getMcpServer(req.params.name as string);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const result = await probeMcpServer(server.name, server.config);
    res.json(result);
  } catch (err) {
    logger.error({ err, name: req.params.name }, "failed to probe MCP server");
    res.status(500).json({ error: "Failed to test MCP server" });
  }
});

// --- Skills management routes ---

app.get("/api/skills", apiLimiter, async (_req, res) => {
  try {
    const skills = await listSkills();
    res.json(skills);
  } catch (err) {
    logger.error({ err }, "failed to list skills");
    res.status(500).json({ error: "Failed to list skills" });
  }
});

app.post("/api/skills/:name/toggle", apiLimiter, async (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }
    await toggleSkill(req.params.name as string, enabled);
    res.json({ ok: true });
  } catch (err) {
    const safe = safeErrorMessage(err);
    if (safe?.includes("not found") || safe?.includes("no SKILL.md")) {
      res.status(404).json({ error: "Skill not found" });
    } else {
      logger.error({ err, name: req.params.name }, "failed to toggle skill");
      res.status(500).json({ error: "Failed to toggle skill" });
    }
  }
});

app.delete("/api/skills/:name", apiLimiter, async (req, res) => {
  try {
    await deleteSkill(req.params.name as string);
    res.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
    } else if (msg.includes("Invalid")) {
      res.status(400).json({ error: msg });
    } else {
      logger.error({ err, name: req.params.name }, "failed to delete skill");
      res.status(500).json({ error: "Failed to delete skill" });
    }
  }
});

app.post("/api/skills", apiLimiter, async (req, res) => {
  try {
    const { name, content } = req.body as { name: string; content: string };
    if (!name || !content) {
      res.status(400).json({ error: "name and content are required" });
      return;
    }
    if (name.length > 64) {
      res.status(400).json({ error: "name exceeds 64 character limit" });
      return;
    }
    if (content.length > MAX_SKILL_CONTENT_LEN) {
      res.status(400).json({
        error: `content exceeds ${MAX_SKILL_CONTENT_LEN} character limit`,
      });
      return;
    }
    await createSkill(name, content);
    res.status(201).json({ ok: true });
  } catch (err) {
    const safe = safeErrorMessage(err);
    if (safe?.includes("already exists")) {
      res.status(409).json({ error: "A skill with that name already exists" });
    } else if (safe) {
      res.status(400).json({ error: safe });
    } else {
      logger.error({ err }, "failed to create skill");
      res.status(500).json({ error: "Failed to create skill" });
    }
  }
});

const extractLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many extraction requests, please try again later" },
});

app.post("/api/skills/extract", extractLimiter, async (req, res) => {
  const ac = new AbortController();
  req.on("close", () => ac.abort());

  try {
    const { conversationId } = req.body as { conversationId: string };
    if (!conversationId) {
      res.status(400).json({ error: "conversationId is required" });
      return;
    }
    const conv = await getConversation(conversationId);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    const draft = await extractSkill(
      conv.messages as Array<{
        role: string;
        blocks: Array<{
          type: string;
          content?: string;
          vizType?: string;
          spl?: string;
        }>;
      }>,
      ac.signal
    );
    if (!res.headersSent) res.json(draft);
  } catch (err) {
    if ((err as Error).name === "AbortedError") {
      logger.debug("skill extraction cancelled by client");
      if (!res.headersSent) res.status(499).end();
      return;
    }
    logger.error({ err }, "failed to extract skill");
    if (!res.headersSent) res.status(500).json({ error: "Skill extraction failed" });
  }
});

app.post("/api/skills/refine", extractLimiter, async (req, res) => {
  const ac = new AbortController();
  req.on("close", () => ac.abort());

  try {
    const { draft, instruction, conversationSummary } = req.body as {
      draft: string;
      instruction: string;
      conversationSummary: string;
    };
    if (!draft || !instruction) {
      res.status(400).json({ error: "draft and instruction are required" });
      return;
    }
    if (draft.length > MAX_SKILL_CONTENT_LEN) {
      res.status(400).json({ error: "draft is too large" });
      return;
    }
    if (instruction.length > MAX_MESSAGE_LEN) {
      res.status(400).json({ error: "instruction is too large" });
      return;
    }
    const updated = await refineSkill(draft, instruction, conversationSummary ?? "", ac.signal);
    if (!res.headersSent) res.json(updated);
  } catch (err) {
    if ((err as Error).name === "AbortedError") {
      logger.debug("skill refinement cancelled by client");
      if (!res.headersSent) res.status(499).end();
      return;
    }
    logger.error({ err }, "failed to refine skill");
    if (!res.headersSent) res.status(500).json({ error: "Skill refinement failed" });
  }
});

app.get("/api/health", async (_req, res) => {
  const result = await runHealthChecks();
  res.status(result.status === "error" ? 503 : 200).json(result);
});

const clientDist = path.resolve(__dirname, "../client");
app.use(express.static(clientDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

function validateStartup(): boolean {
  const envResult = validateEnv();
  if (!envResult.ok) {
    for (const err of envResult.errors) {
      logger.error(`env: ${err}`);
    }
    return false;
  }

  let ok = true;

  const envPath = path.resolve(process.cwd(), ".env");
  try {
    const stat = fs.statSync(envPath);
    const mode = stat.mode & 0o777;
    if (mode & 0o077) {
      logger.warn(
        { path: envPath, mode: `0${mode.toString(8)}` },
        ".env file is readable by other users — consider running: chmod 600 .env"
      );
    }
  } catch {
    /* .env may not exist */
  }

  if (process.env.ANTHROPIC_API_KEY) {
    logger.info("Claude auth: API key");
  } else {
    try {
      const authOutput = execFileSync("claude", ["auth", "status", "--json"], {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      try {
        const authStatus = JSON.parse(authOutput);
        if (authStatus.loggedIn) {
          logger.info("Claude auth: CLI OAuth");
        } else {
          logger.error(
            "Claude CLI is installed but not logged in. Run 'claude auth login' to authenticate."
          );
          ok = false;
        }
      } catch {
        logger.error("Claude CLI returned unexpected output from 'claude auth status --json'");
        ok = false;
      }
    } catch {
      logger.error(
        "Claude CLI not found. Install with 'npm i -g @anthropic-ai/claude-code' then run 'claude auth login' to authenticate."
      );
      ok = false;
    }
  }

  return ok;
}

if (!validateStartup()) {
  logger.fatal("Startup validation failed — fix the errors above and restart");
  process.exit(1);
}

const PORT_CONFLICT_EXIT = 98;

function identifyPortSquatter(port: number): { pid: string; command: string } | null {
  try {
    const pids = execFileSync("lsof", ["-i", `:${port}`, "-t"], { encoding: "utf-8" })
      .trim()
      .split("\n")
      .filter(Boolean);
    if (pids.length === 0) return null;
    const pid = pids[0];
    let command = "(unknown)";
    try {
      command = execFileSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf-8" }).trim();
    } catch {
      /* ps may fail on some systems */
    }
    return { pid, command };
  } catch {
    return null;
  }
}

function probePort(port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (err: NodeJS.ErrnoException) => reject(err));
    probe.listen(port, host, () => {
      probe.close(() => resolve());
    });
  });
}

const PORT_RETRY_DELAYS = [200, 400, 800, 1600, 2000];

async function waitForPort(port: number, host: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await probePort(port, host);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      if (attempt >= PORT_RETRY_DELAYS.length) {
        const squatter = identifyPortSquatter(port);
        if (squatter) {
          logger.fatal(
            { port, squatterPid: squatter.pid, squatterCommand: squatter.command },
            `Port ${port} is already in use by PID ${squatter.pid}\n` +
              `  Command: ${squatter.command}\n` +
              `  Action:  kill ${squatter.pid}   (or use: node bin/opsblaze.cjs stop)`
          );
        } else {
          logger.fatal({ port }, `Port ${port} is already in use (could not identify process)`);
        }
        throw err;
      }
      const delay = PORT_RETRY_DELAYS[attempt];
      logger.info({ port, attempt: attempt + 1 }, `Port ${port} busy, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

try {
  await waitForPort(PORT, HOST);
} catch {
  process.exit(PORT_CONFLICT_EXIT);
}

const server = app.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST }, "OpsBlaze server running");
  logger.info(
    {
      model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
      effort: process.env.CLAUDE_EFFORT || "high",
    },
    "Claude Agent SDK configured"
  );
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    const squatter = identifyPortSquatter(PORT);
    logger.fatal(
      { port: PORT, squatterPid: squatter?.pid, squatterCommand: squatter?.command },
      `Port ${PORT} became unavailable (race condition). ` +
        (squatter
          ? `In use by PID ${squatter.pid}: ${squatter.command}`
          : "Could not identify process.")
    );
    process.exit(PORT_CONFLICT_EXIT);
  }
  logger.fatal({ err }, "server error");
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) {
    logger.info({ signal }, "duplicate shutdown signal ignored");
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "shutdown signal received");
  server.close();

  for (const conn of activeConnections) {
    conn.abort.abort();
  }

  const drainTimeout = setTimeout(() => {
    logger.info("drain timeout reached, forcing exit");
    process.exit(0);
  }, 10_000);
  drainTimeout.unref();

  const check = setInterval(() => {
    if (activeConnections.size === 0) {
      clearInterval(check);
      clearTimeout(drainTimeout);
      logger.info("all connections drained, exiting");
      process.exit(0);
    }
  }, 250);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — shutting down");
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
