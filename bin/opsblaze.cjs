#!/usr/bin/env node

const { spawnSync, spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const SUPERVISOR_SCRIPT = path.join(__dirname, "supervisor.cjs");
const DATA_DIR = path.join(ROOT, "data");
const ENV_FILE = path.join(ROOT, ".env");
const DIST_SERVER = path.join(ROOT, "dist", "server", "index.js");
const STATE_FILE = path.join(DATA_DIR, ".opsblaze-state.json");
const OUT_LOG = path.join(DATA_DIR, "opsblaze-out.log");
const ERR_LOG = path.join(DATA_DIR, "opsblaze-err.log");
const APP_NAME = "opsblaze";

const PORTS = { backend: 3000, vite: 5173 };

if (process.platform === "win32") {
  console.error(
    `\n  ${APP_NAME}: Windows is not currently supported.\n` +
    `  OpsBlaze requires macOS or Linux.\n` +
    `  See https://github.com/jagalliers/opsblaze for updates.\n`
  );
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────

function readPort() {
  try {
    const env = fs.readFileSync(ENV_FILE, "utf-8");
    const match = env.match(/^PORT=(\d+)/m);
    return match ? parseInt(match[1], 10) : PORTS.backend;
  } catch {
    return PORTS.backend;
  }
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeState(mode, pid) {
  ensureDataDir();
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ mode, pid, startedAt: new Date().toISOString() }, null, 2)
  );
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function clearState() {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // already gone
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidsOnPort(port) {
  try {
    const result = spawnSync("lsof", ["-i", `:${port}`, "-t"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    if (result.stdout && result.stdout.trim()) {
      return result.stdout
        .trim()
        .split("\n")
        .map((p) => parseInt(p, 10))
        .filter((p) => !isNaN(p));
    }
  } catch {
    // lsof not available
  }
  return [];
}

function killPid(pid, signal = "SIGTERM") {
  try {
    process.kill(pid, signal);
  } catch {
    // already dead
  }
}

function killProcessTree(pid) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    killPid(pid, "SIGTERM");
  }
  const deadline = Date.now() + 5000;
  while (pidAlive(pid) && Date.now() < deadline) {
    spawnSync("sleep", ["0.2"]);
  }
  if (pidAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      killPid(pid, "SIGKILL");
    }
  }
}

function sweepPorts() {
  let killed = 0;
  const allPids = new Set();
  for (const port of [readPort(), PORTS.vite]) {
    for (const pid of pidsOnPort(port)) {
      allPids.add(pid);
    }
  }
  if (allPids.size === 0) return 0;

  for (const pid of allPids) {
    killPid(pid, "SIGTERM");
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    let anyAlive = false;
    for (const pid of allPids) {
      if (pidAlive(pid)) { anyAlive = true; break; }
    }
    if (!anyAlive) break;
    spawnSync("sleep", ["0.2"]);
  }

  for (const pid of allPids) {
    if (pidAlive(pid)) {
      killPid(pid, "SIGKILL");
    }
    killed++;
  }
  return killed;
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

async function waitForHealth(port, timeoutMs = 15000) {
  const start = Date.now();
  const url = `http://localhost:${port}/api/health`;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function fetchHealthMemory(port) {
  try {
    const response = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data.memory && data.memory.rss) {
        return Math.round(data.memory.rss / 1024 / 1024);
      }
    }
  } catch {
    // not available
  }
  return null;
}

function newestSourceMtime(dir, exts) {
  let newest = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        newest = Math.max(newest, newestSourceMtime(full, exts));
      } else if (entry.isFile() && exts.some((e) => entry.name.endsWith(e))) {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return newest;
}

function buildIsStale() {
  try {
    const buildTime = fs.statSync(DIST_SERVER).mtimeMs;
    const srcDirs = [
      path.join(ROOT, "server"),
      path.join(ROOT, "src"),
    ];
    const exts = [".ts", ".tsx", ".css", ".html"];
    for (const dir of srcDirs) {
      if (newestSourceMtime(dir, exts) > buildTime) return true;
    }
    const rootConfigs = ["vite.config.ts", "tsconfig.json", "tsconfig.server.json", "tailwind.config.ts", "index.html"];
    for (const f of rootConfigs) {
      try {
        if (fs.statSync(path.join(ROOT, f)).mtimeMs > buildTime) return true;
      } catch { /* missing config is fine */ }
    }
    return false;
  } catch {
    return true;
  }
}

function checkBuild() {
  const exists = fs.existsSync(DIST_SERVER);
  const stale = exists && buildIsStale();
  const reason = !exists ? "Build not found" : stale ? "Build is stale (source files changed)" : null;

  if (reason) {
    console.log(`${reason}. Building...`);
    const result = spawnSync("npm", ["run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    if (result.status !== 0) {
      console.error("Build failed. Fix errors and try again.");
      process.exit(1);
    }
    console.log("Build complete.\n");
  }
}

function checkEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(
      "No .env file found. Run 'node bin/setup.cjs' to configure the app."
    );
    process.exit(1);
  }
}

function supervisorIsRunning() {
  const state = readState();
  if (!state || state.mode !== "prod" || !state.pid) return false;
  return pidAlive(state.pid);
}

// ── Core: stop everything ────────────────────────────────────────────

function fullStop() {
  const state = readState();
  let stopped = false;

  if (state && state.mode === "dev" && state.pid) {
    if (pidAlive(state.pid)) {
      killProcessTree(state.pid);
      stopped = true;
    }
  }

  if (state && state.mode === "prod" && state.pid) {
    if (pidAlive(state.pid)) {
      killPid(state.pid, "SIGTERM");
      const deadline = Date.now() + 10000;
      while (pidAlive(state.pid) && Date.now() < deadline) {
        spawnSync("sleep", ["0.3"]);
      }
      if (pidAlive(state.pid)) {
        killPid(state.pid, "SIGKILL");
      }
      stopped = true;
    }
    if (state.childPid && pidAlive(state.childPid)) {
      killPid(state.childPid, "SIGKILL");
      stopped = true;
    }
  }

  const orphans = sweepPorts();
  if (orphans > 0) stopped = true;

  clearState();
  return stopped;
}

// ── Commands ─────────────────────────────────────────────────────────

function stop() {
  const state = readState();
  const modeName = state ? state.mode : "unknown";

  const stopped = fullStop();

  if (stopped) {
    console.log(
      `OpsBlaze stopped (was: ${modeName} mode).`
    );
  } else {
    console.log("OpsBlaze is not running.");
  }
}

function ensurePortsFree(ports) {
  for (const port of ports) {
    const pids = pidsOnPort(port);
    if (pids.length > 0) {
      console.error(
        `Error: port ${port} is still in use by PID ${pids.join(", ")} after cleanup.`
      );
      console.error("Run 'node bin/opsblaze.cjs stop' and try again, or kill the process manually.");
      process.exit(1);
    }
  }
}

async function startProd() {
  checkEnv();

  console.log("Stopping any existing processes...");
  fullStop();

  const port = readPort();
  ensurePortsFree([port]);

  checkBuild();
  ensureDataDir();

  console.log("Starting OpsBlaze (prod mode)...");

  const outFd = fs.openSync(OUT_LOG, "a");
  const errFd = fs.openSync(ERR_LOG, "a");

  const supervisor = spawn(process.execPath, [SUPERVISOR_SCRIPT], {
    cwd: ROOT,
    stdio: ["ignore", outFd, errFd],
    detached: true,
  });

  supervisor.unref();
  fs.closeSync(outFd);
  fs.closeSync(errFd);

  // Give supervisor a moment to write its state file
  await new Promise((r) => setTimeout(r, 500));

  process.stdout.write("Waiting for server");
  const healthy = await waitForHealth(port);

  if (healthy) {
    console.log(" ready!");
    console.log(`\nOpsBlaze is running at http://localhost:${port}`);
  } else {
    console.log(" timed out.");
    console.error(
      "Server may still be starting. Check 'node bin/opsblaze.cjs status' or data/opsblaze-err.log"
    );
  }
}

function startDev() {
  checkEnv();

  console.log("Stopping any existing processes...");
  fullStop();

  ensurePortsFree([readPort(), PORTS.vite]);
  ensureDataDir();

  console.log("Starting OpsBlaze (dev mode)...\n");

  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmBin, ["run", "dev"], {
    cwd: ROOT,
    stdio: "inherit",
    detached: true,
  });

  writeState("dev", child.pid);

  const cleanup = () => {
    killProcessTree(child.pid);
    clearState();
    sweepPorts();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  child.on("exit", (code) => {
    clearState();
    sweepPorts();
    process.exit(code ?? 0);
  });
}

async function restart() {
  const state = readState();

  if (state && state.mode === "dev") {
    console.log("Restarting in dev mode...\n");
    startDev();
    return;
  }

  await startProd();
}

async function status() {
  const C = {
    GREEN: "\x1b[32m",
    RED: "\x1b[31m",
    YELLOW: "\x1b[33m",
    CYAN: "\x1b[36m",
    DIM: "\x1b[2m",
    BOLD: "\x1b[1m",
    RESET: "\x1b[0m",
  };

  const state = readState();
  const port = readPort();

  const backendPids = pidsOnPort(port);
  const vitePids = pidsOnPort(PORTS.vite);
  const supervisorAlive = state && state.mode === "prod" && state.pid && pidAlive(state.pid);

  const actuallyRunning = supervisorAlive || backendPids.length > 0;

  if (!actuallyRunning && !state) {
    console.log(`\n${C.BOLD}OpsBlaze${C.RESET}  ${C.DIM}not running${C.RESET}\n`);
    return;
  }

  let effectiveMode = "unknown";
  if (state) {
    effectiveMode = state.mode;
  } else if (vitePids.length > 0) {
    effectiveMode = "dev";
  }

  const modeLabel =
    effectiveMode === "dev"
      ? `${C.YELLOW}DEV${C.RESET}`
      : effectiveMode === "prod"
        ? `${C.GREEN}PROD${C.RESET}`
        : `${C.RED}UNKNOWN${C.RESET}`;

  console.log(`\n${C.BOLD}OpsBlaze${C.RESET}  ${modeLabel}`);
  console.log(`${"─".repeat(36)}`);

  if (effectiveMode === "prod") {
    const childAlive = state.childPid && pidAlive(state.childPid);
    if (supervisorAlive && childAlive) {
      const uptime = formatUptime(Date.now() - new Date(state.startedAt).getTime());
      const memMb = await fetchHealthMemory(port);
      console.log(`  Backend   ${C.GREEN}●${C.RESET}  :${port}  PID ${state.childPid}`);
      console.log(`  Uptime    ${uptime}`);
      console.log(`  Memory    ${memMb != null ? memMb + "MB" : "?"}`);
      console.log(`  Restarts  ${state.restarts || 0}`);
    } else if (supervisorAlive) {
      console.log(`  Backend   ${C.YELLOW}●${C.RESET}  :${port}  ${C.DIM}(starting or restarting)${C.RESET}`);
    } else {
      console.log(`  Backend   ${C.RED}●${C.RESET}  :${port}  ${C.DIM}(supervisor not running)${C.RESET}`);
    }
  } else if (effectiveMode === "dev") {
    const backendAlive = backendPids.length > 0;
    const viteAlive = vitePids.length > 0;

    console.log(
      `  Backend   ${backendAlive ? `${C.GREEN}●${C.RESET}` : `${C.RED}●${C.RESET}`}  :${port}${backendAlive ? `  PID ${backendPids[0]}` : "  DOWN"}`
    );
    console.log(
      `  Vite      ${viteAlive ? `${C.GREEN}●${C.RESET}` : `${C.RED}●${C.RESET}`}  :${PORTS.vite}${viteAlive ? `  PID ${vitePids[0]}` : "  DOWN"}`
    );

    if (state && state.startedAt) {
      const uptime = formatUptime(Date.now() - new Date(state.startedAt).getTime());
      console.log(`  Uptime    ${uptime}`);
    }

    if (backendAlive && viteAlive) {
      console.log(`\n  ${C.CYAN}→${C.RESET}  Open ${C.BOLD}http://localhost:${PORTS.vite}${C.RESET}`);
    }
  } else {
    if (backendPids.length > 0) {
      console.log(`  :${port}    ${C.YELLOW}●${C.RESET}  PID ${backendPids.join(", ")}  ${C.DIM}(unmanaged)${C.RESET}`);
    }
    if (vitePids.length > 0) {
      console.log(`  :${PORTS.vite}  ${C.YELLOW}●${C.RESET}  PID ${vitePids.join(", ")}  ${C.DIM}(unmanaged)${C.RESET}`);
    }
    console.log(`\n  ${C.YELLOW}⚠${C.RESET}  Unmanaged processes detected. Run ${C.BOLD}stop${C.RESET} to clean up.`);
  }

  console.log("");
}

function logs() {
  const state = readState();

  if (state && state.mode === "dev") {
    console.log("Dev mode logs go to the terminal running the dev server.");
    console.log("Use 'node bin/opsblaze.cjs status' to see process info.");
    return;
  }

  if (!fs.existsSync(OUT_LOG) && !fs.existsSync(ERR_LOG)) {
    console.log("No log files found. Start the server first.");
    return;
  }

  console.log("Tailing logs (Ctrl+C to stop)...\n");

  const files = [OUT_LOG, ERR_LOG].filter((f) => fs.existsSync(f));
  const tail = spawn("tail", ["-f", "-n", "50", ...files], {
    stdio: "inherit",
  });

  const cleanup = () => {
    tail.kill();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  tail.on("exit", (code) => process.exit(code ?? 0));
}

function check() {
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const DIM = "\x1b[2m";
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";

  const ok = (t) => console.log(`  ${GREEN}\u2713${RESET} ${t}`);
  const fail = (t) => console.log(`  ${RED}\u2717${RESET} ${t}`);
  const warn = (t) => console.log(`  ${YELLOW}\u26A0${RESET} ${t}`);

  console.log(`\n${BOLD}OpsBlaze Health Check${RESET}\n`);
  let allOk = true;

  const major = parseInt(process.version.slice(1).split(".")[0], 10);
  if (major >= 20) {
    ok(`Node.js ${process.version}`);
  } else {
    fail(`Node.js ${process.version} — need 20+`);
    allOk = false;
  }

  if (fs.existsSync(ENV_FILE)) {
    const envContent = fs.readFileSync(ENV_FILE, "utf-8");
    if (/^SPLUNK_HOST=/m.test(envContent)) {
      ok(".env file with SPLUNK_HOST");
    } else {
      fail(".env exists but SPLUNK_HOST is not set");
      allOk = false;
    }
  } else {
    fail(".env file not found — run 'node bin/setup.cjs'");
    allOk = false;
  }

  try {
    const ver = execFileSync("claude", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    }).trim();
    ok(`Claude CLI: ${ver || "found"}`);
  } catch {
    if (fs.existsSync(ENV_FILE)) {
      const envContent = fs.readFileSync(ENV_FILE, "utf-8");
      if (/^ANTHROPIC_API_KEY=.+/m.test(envContent)) {
        ok("Claude auth: API key (ANTHROPIC_API_KEY)");
      } else {
        fail("Claude CLI not found or not authenticated");
        console.log(`    ${DIM}Install: npm i -g @anthropic-ai/claude-code${RESET}`);
        console.log(`    ${DIM}Then run: claude auth login${RESET}`);
        allOk = false;
      }
    } else {
      fail("Claude CLI not found or not authenticated");
      console.log(`    ${DIM}Install: npm i -g @anthropic-ai/claude-code${RESET}`);
      console.log(`    ${DIM}Then run: claude auth login${RESET}`);
      allOk = false;
    }
  }

  const hasServer = fs.existsSync(DIST_SERVER);
  const hasClient = fs.existsSync(
    path.join(ROOT, "dist", "client", "index.html")
  );
  if (hasServer && hasClient) {
    ok("Build artifacts present");
  } else {
    fail(
      `Build incomplete — missing ${!hasServer ? "server" : ""}${!hasServer && !hasClient ? " and " : ""}${!hasClient ? "client" : ""}`
    );
    console.log(`    ${DIM}Run: npm run build${RESET}`);
    allOk = false;
  }

  const state = readState();
  if (state) {
    ok(`Currently in ${state.mode} mode (PID ${state.pid})`);
  } else {
    const port = readPort();
    const squatters = pidsOnPort(port);
    if (squatters.length > 0) {
      warn(`Port ${port} in use by PID ${squatters.join(", ")} (not managed by OpsBlaze)`);
    } else {
      ok(`Port ${port} available`);
    }
  }

  console.log("");
  if (allOk) {
    console.log(`  ${GREEN}All checks passed.${RESET}\n`);
  } else {
    console.log(`  ${RED}Some checks failed. Fix the issues above and re-run.${RESET}\n`);
  }
}

const SPLUNK_PKGS = [
  "@splunk/visualizations",
  "@splunk/visualization-context",
  "@splunk/visualization-themes",
  "@splunk/themes",
];

function splunkVizInstalled() {
  return fs.existsSync(
    path.join(ROOT, "node_modules", "@splunk", "visualizations")
  );
}

function stripSplunkPeerDeps() {
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const removed = { peer: {}, meta: {} };
  for (const name of SPLUNK_PKGS) {
    if (pkg.peerDependencies && pkg.peerDependencies[name]) {
      removed.peer[name] = pkg.peerDependencies[name];
      delete pkg.peerDependencies[name];
    }
    if (pkg.peerDependenciesMeta && pkg.peerDependenciesMeta[name]) {
      removed.meta[name] = pkg.peerDependenciesMeta[name];
      delete pkg.peerDependenciesMeta[name];
    }
  }
  if (
    pkg.peerDependencies &&
    Object.keys(pkg.peerDependencies).length === 0
  ) {
    delete pkg.peerDependencies;
  }
  if (
    pkg.peerDependenciesMeta &&
    Object.keys(pkg.peerDependenciesMeta).length === 0
  ) {
    delete pkg.peerDependenciesMeta;
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return removed;
}

function restoreSplunkPeerDeps(removed) {
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  if (Object.keys(removed.peer).length) {
    pkg.peerDependencies = { ...pkg.peerDependencies, ...removed.peer };
  }
  if (Object.keys(removed.meta).length) {
    pkg.peerDependenciesMeta = {
      ...pkg.peerDependenciesMeta,
      ...removed.meta,
    };
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

async function installSplunkViz() {
  if (splunkVizInstalled()) {
    console.log("\nSplunk visualization packages are already installed.");
    console.log("To reinstall, remove node_modules/@splunk first.\n");
    return;
  }

  console.log("\nNote: @splunk/* packages are proprietary software subject to");
  console.log("Splunk's own license terms and are not distributed with OpsBlaze.\n");
  console.log("Installing Splunk visualization packages...\n");

  // npm arborist crashes when installing a package that is also declared as a
  // peerDependency in the same package.json.  Work around by temporarily
  // removing the peer declarations, installing, then restoring them.
  const removed = stripSplunkPeerDeps();

  const result = spawnSync(
    "npm",
    ["install", "--save", ...SPLUNK_PKGS, "--legacy-peer-deps"],
    { cwd: ROOT, stdio: "inherit", shell: true }
  );

  restoreSplunkPeerDeps(removed);

  // After restoring peerDeps, also remove the packages from dependencies
  // (they were added by --save) so the open-source package.json stays clean.
  const pkgPath = path.join(ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  for (const name of SPLUNK_PKGS) {
    if (pkg.dependencies && pkg.dependencies[name]) {
      delete pkg.dependencies[name];
    }
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  if (result.status !== 0) {
    console.error("\nFailed to install Splunk visualization packages.");
    process.exit(1);
  }

  console.log("\nSplunk visualizations installed. Rebuilding...\n");

  const buildResult = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  if (buildResult.status !== 0) {
    console.error("Build failed after installing Splunk packages.");
    process.exit(1);
  }

  if (!splunkVizInstalled()) {
    console.error(
      "\nBuild completed but Splunk visualizations were not detected."
    );
    console.error("Check that the packages installed correctly.\n");
    process.exit(1);
  }

  // Write marker so postinstall auto-restores after future `npm install`
  const markerPath = path.join(DATA_DIR, ".splunk-viz-enabled");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(markerPath, new Date().toISOString() + "\n");

  console.log("\nDone! Restart the server to use Splunk visualizations.");
  console.log(
    "Splunk viz will be auto-restored after future npm install runs.\n"
  );
}

// ── Main ─────────────────────────────────────────────────────────────

const command = process.argv[2];
const commands = {
  start: startProd,
  stop,
  restart,
  status,
  logs,
  check,
  dev: startDev,
  "install-splunk-viz": installSplunkViz,
};

if (!command || !commands[command]) {
  console.log("Usage: node bin/opsblaze.cjs <command>\n");
  console.log("Commands:");
  console.log("  dev                Start in development mode (tsx watch + Vite)");
  console.log("  start              Start in production mode (daemonized)");
  console.log("  stop               Stop everything (dev or prod, plus orphan cleanup)");
  console.log("  restart            Restart in the current mode");
  console.log("  status             Show what's running, which mode, PIDs, ports");
  console.log("  logs               Tail production logs");
  console.log("  check              Validate environment and prerequisites");
  console.log("  install-splunk-viz Install optional Splunk visualization packages");
  console.log("");
  console.log("Start/dev always stops the other mode first. Stop cleans everything.");
  process.exit(command ? 1 : 0);
}

Promise.resolve(commands[command]()).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
