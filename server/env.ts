import { z } from "zod";

const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  SPLUNK_HOST: z.string().min(1, "SPLUNK_HOST is required"),
  SPLUNK_PORT: positiveInt.max(65535).default(8089),
  SPLUNK_SCHEME: z.enum(["http", "https"]).default("https"),
  SPLUNK_TOKEN: z.string().optional(),
  SPLUNK_USERNAME: z.string().optional(),
  SPLUNK_PASSWORD: z.string().optional(),
  SPLUNK_VERIFY_SSL: z
    .enum(["true", "false", "1", "0"])
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  SPLUNK_TIMEOUT_MS: positiveInt.default(60_000),

  MAX_ROW_LIMIT: positiveInt.default(10_000),
  SPL_SAFETY_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-opus-4-6"),
  CLAUDE_EFFORT: z.enum(["low", "medium", "high", "max"]).default("high"),

  PORT: positiveInt.max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),

  OPSBLAZE_ALLOWED_ORIGINS: z.string().optional(),
  OPSBLAZE_RATE_LIMIT: positiveInt.default(10),
  OPSBLAZE_STREAM_TIMEOUT_MS: positiveInt.default(300_000),
  OPSBLAZE_MAX_TURNS: positiveInt.default(30),
  OPSBLAZE_MAX_HISTORY: positiveInt.default(20),
  OPSBLAZE_MAX_MESSAGE_LEN: positiveInt.default(10_000),

  OPSBLAZE_DATA_DIR: z.string().optional(),
  OPSBLAZE_RECORD_DIR: z.string().optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let _validatedEnv: AppEnv | null = null;

/**
 * Validates environment variables against the schema.
 * Returns parsed config or an array of human-readable error strings.
 * On success, caches the result for retrieval via getEnv().
 */
export function validateEnv(): { ok: true; env: AppEnv } | { ok: false; errors: string[] } {
  const result = envSchema.safeParse(process.env);
  if (result.success) {
    _validatedEnv = result.data;
    return { ok: true, env: result.data };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
  return { ok: false, errors };
}

/**
 * Returns the validated environment config. Must be called after
 * validateEnv() succeeds — throws if validation hasn't run yet.
 */
export function getEnv(): AppEnv {
  if (!_validatedEnv) {
    throw new Error("getEnv() called before validateEnv() — check startup order");
  }
  return _validatedEnv;
}
