#!/usr/bin/env node

/**
 * OpsBlaze production supervisor.
 *
 * Spawned as a detached daemon by `opsblaze start`. Manages the Node.js
 * server process with auto-restart, exponential backoff, and log file
 * management. Communicates state via data/.opsblaze-state.json.
 */

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, ".opsblaze-state.json");
const OUT_LOG = path.join(DATA_DIR, "opsblaze-out.log");
const ERR_LOG = path.join(DATA_DIR, "opsblaze-err.log");
const SERVER_SCRIPT = path.join(ROOT, "dist", "server", "index.js");

const MAX_RESTARTS = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const HEALTHY_THRESHOLD_MS = 30000;
const LOG_ROTATE_BYTES = 10 * 1024 * 1024; // 10 MB
const LOG_ROTATE_KEEP = 3;

let child = null;
let restartCount = 0;
let startedAt = new Date().toISOString();
let stopping = false;

function writeState() {
  const state = {
    mode: "prod",
    pid: process.pid,
    childPid: child ? child.pid : null,
    startedAt,
    restarts: restartCount,
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    // best effort
  }
}

function clearState() {
  try { fs.unlinkSync(STATE_FILE); } catch { /* already gone */ }
}

function timestamp() {
  return new Date().toISOString();
}

function appendLog(file, msg) {
  try {
    fs.appendFileSync(file, `[${timestamp()}] ${msg}\n`);
  } catch { /* best effort */ }
}

function readPort() {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf-8");
    const match = env.match(/^PORT=(\d+)/m);
    return match ? parseInt(match[1], 10) : 3000;
  } catch {
    return 3000;
  }
}

function portInUse(port) {
  try {
    const result = spawnSync("lsof", ["-i", `:${port}`, "-t"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    return !!(result.stdout && result.stdout.trim());
  } catch {
    return false;
  }
}

function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (portInUse(port) && Date.now() < deadline) {
    spawnSync("sleep", ["0.25"]);
  }
}

function startServer() {
  const envPath = path.join(ROOT, ".env");
  const extraEnv = {};
  try {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) extraEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env */ }

  const outStream = fs.openSync(OUT_LOG, "a");
  const errStream = fs.openSync(ERR_LOG, "a");

  child = spawn(process.execPath, ["--enable-source-maps", SERVER_SCRIPT], {
    cwd: ROOT,
    stdio: ["ignore", outStream, errStream],
    env: { ...process.env, ...extraEnv, NODE_ENV: "production" },
  });

  fs.closeSync(outStream);
  fs.closeSync(errStream);

  appendLog(OUT_LOG, `supervisor: started server PID ${child.pid} (restart #${restartCount})`);
  writeState();

  const spawnTime = Date.now();

  child.on("exit", (code, signal) => {
    if (stopping) {
      appendLog(OUT_LOG, `supervisor: server exited (shutdown)`);
      clearState();
      process.exit(0);
      return;
    }

    const lived = Date.now() - spawnTime;
    appendLog(ERR_LOG, `supervisor: server exited code=${code} signal=${signal} after ${lived}ms`);

    if (lived > HEALTHY_THRESHOLD_MS) {
      restartCount = 0;
    }

    restartCount++;

    if (restartCount > MAX_RESTARTS) {
      appendLog(ERR_LOG, `supervisor: max restarts (${MAX_RESTARTS}) exceeded, giving up`);
      clearState();
      process.exit(1);
    }

    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, restartCount - 1), MAX_DELAY_MS);
    appendLog(OUT_LOG, `supervisor: restarting in ${delay}ms (attempt ${restartCount}/${MAX_RESTARTS})`);

    setTimeout(() => {
      waitForPortFree(readPort(), 5000);
      startServer();
    }, delay);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  appendLog(OUT_LOG, "supervisor: received shutdown signal");

  if (child && child.pid) {
    try { process.kill(child.pid, "SIGTERM"); } catch { /* already dead */ }

    const deadline = Date.now() + 10000;
    const poll = setInterval(() => {
      try {
        process.kill(child.pid, 0);
        if (Date.now() > deadline) {
          try { process.kill(child.pid, "SIGKILL"); } catch { /* ok */ }
          clearInterval(poll);
          clearState();
          process.exit(0);
        }
      } catch {
        clearInterval(poll);
        clearState();
        process.exit(0);
      }
    }, 200);
  } else {
    clearState();
    process.exit(0);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function rotateIfNeeded(logPath) {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < LOG_ROTATE_BYTES) return;
  } catch {
    return; // file doesn't exist yet
  }
  for (let i = LOG_ROTATE_KEEP; i >= 1; i--) {
    const src = i === 1 ? logPath : `${logPath}.${i - 1}`;
    const dst = `${logPath}.${i}`;
    try {
      if (i === LOG_ROTATE_KEEP) fs.unlinkSync(dst);
    } catch { /* already gone */ }
    try {
      fs.renameSync(src, dst);
    } catch { /* source doesn't exist */ }
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
rotateIfNeeded(OUT_LOG);
rotateIfNeeded(ERR_LOG);
appendLog(OUT_LOG, `supervisor: starting (PID ${process.pid})`);
startServer();
