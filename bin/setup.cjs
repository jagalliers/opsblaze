#!/usr/bin/env node

const readline = require("readline");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");

if (process.platform === "win32") {
  console.error(
    "\n  opsblaze: Windows is not currently supported.\n" +
    "  OpsBlaze requires macOS or Linux.\n" +
    "  See https://github.com/jagalliers/opsblaze for updates.\n"
  );
  process.exit(1);
}

// --- UI Helpers ---

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function heading(text) {
  console.log(`\n${BOLD}${CYAN}${text}${RESET}\n`);
}

function ok(text) {
  console.log(`  ${GREEN}\u2713${RESET} ${text}`);
}

function warn(text) {
  console.log(`  ${YELLOW}\u26A0${RESET} ${text}`);
}

function fail(text) {
  console.log(`  ${RED}\u2717${RESET} ${text}`);
}

function info(text) {
  console.log(`  ${DIM}${text}${RESET}`);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(prompt, defaultVal) {
  const suffix = defaultVal ? ` ${DIM}[${defaultVal}]${RESET}` : "";
  return new Promise((resolve) => {
    rl.question(`  ${prompt}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

function askYesNo(prompt, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`  ${prompt} ${DIM}[${hint}]${RESET}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

function askChoice(prompt, options) {
  console.log(`  ${prompt}`);
  options.forEach((opt, i) => {
    console.log(`    ${DIM}${i + 1})${RESET} ${opt.label}`);
  });
  return new Promise((resolve) => {
    rl.question(`  Choice ${DIM}[1]${RESET}: `, (answer) => {
      const idx = parseInt(answer.trim() || "1", 10) - 1;
      resolve(options[Math.max(0, Math.min(idx, options.length - 1))].value);
    });
  });
}

// --- Prerequisite Checks ---

function checkNode() {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0], 10);
  if (major >= 20) {
    ok(`Node.js ${version}`);
    return true;
  }
  fail(`Node.js ${version} \u2014 version 20 or later is required`);
  return false;
}

function checkNpm() {
  try {
    const version = execFileSync("npm", ["--version"], { encoding: "utf-8", timeout: 5000 }).trim();
    ok(`npm ${version}`);
    return true;
  } catch {
    fail("npm not found \u2014 install Node.js from https://nodejs.org");
    return false;
  }
}

function checkClaude() {
  try {
    const version = execFileSync("claude", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    ok(`Claude CLI: ${version || "found"}`);
    return true;
  } catch {
    try {
      const version = execFileSync("claude", ["-v"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      ok(`Claude CLI: ${version || "found"}`);
      return true;
    } catch {
      fail("Claude CLI not found");
      info("Install: npm install -g @anthropic-ai/claude-code");
      info("Then run: claude    (to complete OAuth authentication)");
      return false;
    }
  }
}

function validatePort(value, label) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 65535 || String(n) !== value) {
    fail(`${label} must be a number between 1 and 65535`);
    rl.close();
    process.exit(1);
  }
  return n;
}

// --- Splunk Connectivity Test ---

function testSplunkConnection(config) {
  return new Promise((resolve) => {
    const isHttps = config.scheme === "https";
    const transport = isHttps ? https : http;

    const options = {
      hostname: config.host,
      port: config.port,
      path: "/services/server/info?output_mode=json",
      method: "GET",
      headers: {
        Authorization: config.token
          ? `Bearer ${config.token}`
          : `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      },
      timeout: 10000,
      rejectUnauthorized: config.verifySsl,
    };

    const req = transport.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(body);
            const serverName =
              data.entry?.[0]?.content?.serverName || "unknown";
            resolve({ ok: true, serverName });
          } catch {
            resolve({ ok: true, serverName: "unknown" });
          }
        } else {
          resolve({
            ok: false,
            error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}`,
          });
        }
      });
    });

    req.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "Connection timed out" });
    });

    req.end();
  });
}

// --- Splunk Config (shared by both modes) ---

async function collectSplunkConfig() {
  const splunkHost = await ask("Splunk host", "localhost");
  const splunkPort = await ask("Splunk management port", "8089");
  validatePort(splunkPort, "Splunk port");
  const splunkScheme = await askChoice("Protocol", [
    { label: "https (default)", value: "https" },
    { label: "http", value: "http" },
  ]);

  const authMethod = await askChoice("Authentication method", [
    { label: "Auth token (Bearer)", value: "token" },
    { label: "Username and password", value: "userpass" },
  ]);

  let splunkToken = "";
  let splunkUsername = "";
  let splunkPassword = "";

  if (authMethod === "token") {
    splunkToken = await ask("Splunk auth token");
    if (!splunkToken) {
      fail("Token cannot be empty");
      rl.close();
      process.exit(1);
    }
  } else {
    splunkUsername = await ask("Splunk username", "admin");
    splunkPassword = await ask("Splunk password");
    if (!splunkPassword) {
      fail("Password cannot be empty");
      rl.close();
      process.exit(1);
    }
  }

  let verifySsl = true;
  if (splunkScheme === "https") {
    verifySsl = await askYesNo("Verify SSL certificate? (set No for self-signed certs)", false);
  }

  // Test connection
  console.log("");
  process.stdout.write("  Testing Splunk connection...");

  const testResult = await testSplunkConnection({
    host: splunkHost,
    port: parseInt(splunkPort, 10),
    scheme: splunkScheme,
    token: splunkToken,
    username: splunkUsername,
    password: splunkPassword,
    verifySsl,
  });

  if (testResult.ok) {
    console.log(` ${GREEN}connected!${RESET}`);
    ok(`Server: ${testResult.serverName}`);
  } else {
    console.log(` ${RED}failed${RESET}`);
    fail(testResult.error);
    const proceed = await askYesNo(
      "Save configuration anyway? (you can fix it later in .env)",
      true
    );
    if (!proceed) {
      console.log("\nSetup cancelled.\n");
      rl.close();
      process.exit(0);
    }
  }

  return {
    splunkHost,
    splunkPort,
    splunkScheme,
    splunkToken,
    splunkUsername,
    splunkPassword,
    verifySsl,
  };
}

// --- Main Setup Flow ---

async function main() {
  console.log(
    `\n${BOLD}OpsBlaze Setup${RESET} \u2014 AI-Powered Narrative Investigation\n`
  );
  console.log(
    `${DIM}This wizard will configure the app and verify your environment.${RESET}`
  );

  // --- Prerequisites ---
  heading("1. Checking prerequisites");

  const nodeOk = checkNode();
  const npmOk = checkNpm();

  if (!nodeOk || !npmOk) {
    console.log(
      `\n${RED}Cannot continue without Node.js 20+ and npm.${RESET}\n`
    );
    rl.close();
    process.exit(1);
  }

  // --- Existing .env check ---
  if (fs.existsSync(ENV_FILE)) {
    warn(".env file already exists");
    const overwrite = await askYesNo(
      "Overwrite existing configuration?",
      false
    );
    if (!overwrite) {
      heading("Skipping configuration \u2014 using existing .env");
      await installAndBuild();
      finish();
      return;
    }
  }

  // --- Claude Authentication ---
  heading("2. Claude authentication");

  const claudeAuthMethod = await askChoice("How would you like to authenticate with Claude?", [
    { label: "Claude CLI OAuth (Claude Pro/Max subscription)", value: "cli" },
    { label: "Anthropic API key (pay-per-use billing)", value: "apikey" },
  ]);

  let anthropicKey = "";

  if (claudeAuthMethod === "cli") {
    const claudeOk = checkClaude();
    if (!claudeOk) {
      const proceed = await askYesNo(
        "Continue anyway? (you can install Claude CLI later before starting the app)",
        false
      );
      if (!proceed) {
        console.log(
          `\nSetup paused. Install and authenticate Claude CLI, then re-run setup.\n`
        );
        rl.close();
        process.exit(0);
      }
    }
  } else {
    anthropicKey = await ask("Anthropic API key");
    if (!anthropicKey) {
      fail("API key cannot be empty");
      rl.close();
      process.exit(1);
    }
    ok("API key configured");
  }

  // --- Splunk Connection ---
  heading("3. Splunk connection");

  const splunk = await collectSplunkConfig();

  // --- App settings ---
  heading("4. App settings");

  const port = await ask("Server port", "3000");
  validatePort(port, "Server port");

  // --- Advanced settings ---
  heading("5. Advanced settings (optional)");

  info("Press Enter to accept defaults and skip any of these.");
  console.log("");

  const host = await ask("Bind address (use 0.0.0.0 for remote access)", "127.0.0.1");
  const claudeModel = await ask("Claude model", "claude-opus-4-6");

  // --- Write .env ---
  heading("6. Writing configuration");

  const envLines = [
    "# Splunk connection",
    `SPLUNK_HOST=${splunk.splunkHost}`,
    `SPLUNK_PORT=${splunk.splunkPort}`,
    `SPLUNK_SCHEME=${splunk.splunkScheme}`,
  ];

  if (splunk.splunkToken) {
    envLines.push(`SPLUNK_TOKEN=${splunk.splunkToken}`);
  } else {
    envLines.push(`SPLUNK_USERNAME=${splunk.splunkUsername}`);
    envLines.push(`SPLUNK_PASSWORD=${splunk.splunkPassword}`);
  }

  envLines.push(`SPLUNK_VERIFY_SSL=${splunk.verifySsl}`);
  envLines.push("");
  envLines.push("# Server");
  envLines.push(`PORT=${port}`);

  if (anthropicKey) {
    envLines.push("");
    envLines.push("# Claude authentication");
    envLines.push(`ANTHROPIC_API_KEY=${anthropicKey}`);
  }

  if (host && host !== "127.0.0.1") {
    envLines.push(`HOST=${host}`);
  }

  if (claudeModel && claudeModel !== "claude-opus-4-6") {
    envLines.push(`CLAUDE_MODEL=${claudeModel}`);
  }

  envLines.push("");

  fs.writeFileSync(ENV_FILE, envLines.join("\n") + "\n");
  ok("Configuration written to .env");

  // --- Install & Build ---
  await installAndBuild();

  finish();
}

async function installAndBuild() {
  heading("7. Installing dependencies");

  const installResult = spawnSync("npm", ["install", "--legacy-peer-deps"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  if (installResult.status !== 0) {
    fail("npm install failed");
    rl.close();
    process.exit(1);
  }
  ok("Dependencies installed");

  // Optional Splunk visualizations
  heading("7b. Enhanced Visualizations (optional)");

  console.log(`  ${DIM}OpsBlaze includes Chart.js charts by default.${RESET}`);
  console.log(`  ${DIM}If you have access to the @splunk/visualizations npm packages,${RESET}`);
  console.log(`  ${DIM}you can install them for premium charts.${RESET}`);
  console.log(`  ${DIM}Note: @splunk/* packages are proprietary software subject to${RESET}`);
  console.log(`  ${DIM}Splunk's own license terms and are not distributed with OpsBlaze.${RESET}`);
  console.log("");

  const wantSplunkViz = await askYesNo("Install Splunk visualizations?", false);

  if (wantSplunkViz) {
    process.stdout.write("  Installing Splunk visualization packages...");

    const splunkPkgs = [
      "@splunk/visualizations",
      "@splunk/visualization-context",
      "@splunk/visualization-themes",
      "@splunk/themes",
    ];

    // npm arborist crashes when installing a package that is also declared as
    // a peerDependency in the same package.json.  Temporarily strip them.
    const pkgPath = path.join(ROOT, "package.json");
    const pkgBefore = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgBefore);
    for (const name of splunkPkgs) {
      if (pkg.peerDependencies) delete pkg.peerDependencies[name];
      if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
    }
    if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length === 0) delete pkg.peerDependencies;
    if (pkg.peerDependenciesMeta && Object.keys(pkg.peerDependenciesMeta).length === 0) delete pkg.peerDependenciesMeta;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    const splunkResult = spawnSync(
      "npm",
      ["install", "--save", ...splunkPkgs, "--legacy-peer-deps"],
      { cwd: ROOT, stdio: "pipe", shell: true }
    );

    // Restore original package.json (peerDeps back, Splunk out of deps)
    fs.writeFileSync(pkgPath, pkgBefore);

    if (splunkResult.status === 0) {
      console.log(` ${GREEN}done${RESET}`);
      ok("Splunk visualizations installed");
    } else {
      console.log(` ${RED}failed${RESET}`);
      warn("Splunk visualizations could not be installed (charts will use Chart.js)");
    }
  } else {
    info("Skipped \u2014 charts will render with Chart.js (you can add Splunk viz later)");
    info("Run: node bin/opsblaze.cjs install-splunk-viz");
  }

  heading("8. Building application");

  const buildResult = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  if (buildResult.status !== 0) {
    fail("Build failed");
    rl.close();
    process.exit(1);
  }
  ok("Build complete");
}

function finish() {
  const port = readPortFromEnv();
  heading("Setup complete!");

  console.log("  Start the server:");
  console.log(`    ${CYAN}node bin/opsblaze.cjs start${RESET}\n`);
  console.log(
    `  Then open ${CYAN}http://localhost:${port}${RESET} in your browser.\n`
  );

  console.log("  Other commands:");
  console.log(`    ${DIM}node bin/opsblaze.cjs stop${RESET}      Stop the server`);
  console.log(
    `    ${DIM}node bin/opsblaze.cjs status${RESET}    Check if running`
  );
  console.log(
    `    ${DIM}node bin/opsblaze.cjs restart${RESET}   Restart the server`
  );
  console.log(`    ${DIM}node bin/opsblaze.cjs logs${RESET}      Tail server logs`);
  console.log("");

  console.log(`  ${DIM}Note: To change Splunk connection settings later, edit .env and${RESET}`);
  console.log(`  ${DIM}restart with: node bin/opsblaze.cjs restart${RESET}`);
  console.log("");

  rl.close();
}

function readPortFromEnv() {
  try {
    const env = fs.readFileSync(ENV_FILE, "utf-8");
    const match = env.match(/^PORT=(\d+)/m);
    return match ? match[1] : "3000";
  } catch {
    return "3000";
  }
}

main().catch((err) => {
  console.error(`\n${RED}Setup failed: ${err.message}${RESET}\n`);
  rl.close();
  process.exit(1);
});
