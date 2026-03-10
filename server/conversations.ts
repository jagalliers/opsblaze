import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import path from "path";
import { logger } from "./logger.js";

export interface StoredConversation {
  id: string;
  title: string;
  messages: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

const DATA_DIR = path.resolve(process.env.OPSBLAZE_DATA_DIR ?? "./data/conversations");

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function safePath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) throw new Error("Invalid conversation ID");
  const resolved = path.resolve(DATA_DIR, `${safe}.json`);
  if (!resolved.startsWith(DATA_DIR + path.sep)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  await ensureDir();
  const files = await readdir(DATA_DIR);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  const summaries: ConversationSummary[] = [];
  for (const file of jsonFiles) {
    try {
      const raw = await readFile(path.join(DATA_DIR, file), "utf-8");
      const conv = JSON.parse(raw) as StoredConversation;
      summaries.push({
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length,
      });
    } catch (err) {
      logger.warn({ file, err }, "skipping corrupt conversation file");
    }
  }

  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return summaries;
}

export async function getConversation(id: string): Promise<StoredConversation | null> {
  try {
    const raw = await readFile(safePath(id), "utf-8");
    return JSON.parse(raw) as StoredConversation;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.error({ id, err }, "failed to read conversation");
    }
    return null;
  }
}

export async function saveConversation(conv: StoredConversation): Promise<void> {
  await ensureDir();
  await writeFile(safePath(conv.id), JSON.stringify(conv, null, 2), "utf-8");
}

export async function deleteConversation(id: string): Promise<boolean> {
  try {
    await unlink(safePath(id));
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.error({ id, err }, "failed to delete conversation");
    }
    return false;
  }
}

export interface SearchResult extends ConversationSummary {
  snippet?: string;
}

const SNIPPET_RADIUS = 50;

function extractSnippet(text: string, query: string): string | undefined {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return undefined;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  let snippet = text.slice(start, end).replace(/\n+/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

/**
 * Searches conversations by title and text block content.
 * Returns matches with a contextual snippet.
 */
export async function searchConversations(query: string): Promise<SearchResult[]> {
  await ensureDir();
  const files = await readdir(DATA_DIR);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(path.join(DATA_DIR, file), "utf-8");
      const conv = JSON.parse(raw) as StoredConversation;

      let snippet: string | undefined;

      if (conv.title.toLowerCase().includes(q)) {
        snippet = conv.title;
      }

      if (!snippet && Array.isArray(conv.messages)) {
        for (const msg of conv.messages as Array<{
          blocks?: Array<{ type: string; content?: string }>;
        }>) {
          if (!Array.isArray(msg.blocks)) continue;
          for (const block of msg.blocks) {
            if (block.type === "text" && typeof block.content === "string") {
              snippet = extractSnippet(block.content, query);
              if (snippet) break;
            }
          }
          if (snippet) break;
        }
      }

      if (snippet) {
        results.push({
          id: conv.id,
          title: conv.title,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
          messageCount: conv.messages.length,
          snippet,
        });
      }
    } catch (err) {
      logger.warn({ file, err }, "skipping corrupt conversation file in search");
    }
  }

  results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return results;
}

/**
 * Deletes conversations older than `maxAgeDays` that haven't been updated.
 * Returns count of deleted conversations.
 */
export async function cleanupConversations(maxAgeDays: number): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const summaries = await listConversations();
  let deleted = 0;

  for (const conv of summaries) {
    const updatedAt = new Date(conv.updatedAt).getTime();
    if (updatedAt < cutoff) {
      const ok = await deleteConversation(conv.id);
      if (ok) deleted++;
    }
  }

  if (deleted > 0) {
    logger.info({ deleted, maxAgeDays }, "conversation cleanup complete");
  }
  return deleted;
}
