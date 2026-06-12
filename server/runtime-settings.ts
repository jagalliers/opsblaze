import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { z } from "zod";
import { logger } from "./logger.js";

const runtimeSettingsSchema = z.object({
  claudeModel: z.string().min(1).optional(),
  claudeEffort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  maxTurns: z.number().int().min(1).max(200).optional(),
  streamTimeoutMs: z.number().int().min(30_000).max(1_800_000).optional(),
});

export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;

const DATA_ROOT = path.resolve(
  process.env.OPSBLAZE_DATA_DIR ? path.dirname(process.env.OPSBLAZE_DATA_DIR) : "./data"
);
const SETTINGS_PATH = path.join(DATA_ROOT, "runtime-settings.json");

async function ensureDir() {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
}

export async function loadRuntimeSettings(): Promise<RuntimeSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return runtimeSettingsSchema.parse(parsed);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.error({ err }, "failed to read runtime settings");
    }
    return {};
  }
}

export async function updateRuntimeSettings(
  partial: Partial<RuntimeSettings>
): Promise<RuntimeSettings> {
  const current = await loadRuntimeSettings();
  const merged = { ...current, ...partial };

  // Remove keys that are explicitly set to undefined
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete (merged as Record<string, unknown>)[key];
  }

  const validated = runtimeSettingsSchema.parse(merged);
  await ensureDir();
  await writeFile(SETTINGS_PATH, JSON.stringify(validated, null, 2), "utf-8");
  logger.info({ settings: validated }, "runtime settings updated");
  return validated;
}

export async function getClaudeModel(): Promise<string> {
  const settings = await loadRuntimeSettings();
  return settings.claudeModel || process.env.CLAUDE_MODEL || "claude-opus-4-8";
}

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

const EFFORT_LEVELS: readonly ClaudeEffort[] = ["low", "medium", "high", "xhigh", "max"];

export async function getClaudeEffort(): Promise<ClaudeEffort> {
  const settings = await loadRuntimeSettings();
  const effort = settings.claudeEffort || process.env.CLAUDE_EFFORT;
  if (EFFORT_LEVELS.includes(effort as ClaudeEffort)) {
    return effort as ClaudeEffort;
  }
  return "high";
}

export async function getMaxTurns(): Promise<number> {
  const settings = await loadRuntimeSettings();
  return settings.maxTurns || parseInt(process.env.OPSBLAZE_MAX_TURNS ?? "120", 10);
}

export async function getStreamTimeoutMs(): Promise<number> {
  const settings = await loadRuntimeSettings();
  return (
    settings.streamTimeoutMs || parseInt(process.env.OPSBLAZE_STREAM_TIMEOUT_MS ?? "900000", 10)
  );
}
