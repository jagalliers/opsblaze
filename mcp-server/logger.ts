const LEVELS: Record<string, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const threshold = LEVELS[configured] ?? LEVELS.info;

function emit(level: string, msg: string): void {
  if ((LEVELS[level] ?? 0) < threshold) return;
  const ts = new Date().toISOString();
  console.error(`[${ts}] [opsblaze-splunk] ${level.toUpperCase()} ${msg}`);
}

export const log = {
  fatal: (msg: string) => emit("fatal", msg),
  error: (msg: string) => emit("error", msg),
  warn: (msg: string) => emit("warn", msg),
  info: (msg: string) => emit("info", msg),
  debug: (msg: string) => emit("debug", msg),
  trace: (msg: string) => emit("trace", msg),
};
