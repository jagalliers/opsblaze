#!/usr/bin/env node

// Auto-restores optional Splunk visualization packages after `npm install`
// when the local machine has previously opted in via `install-splunk-viz`.
// The marker file (data/.splunk-viz-enabled) is gitignored and only exists
// on machines where the user explicitly installed Splunk visualizations.

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const MARKER = path.join(ROOT, "data", ".splunk-viz-enabled");
const SPLUNK_DIR = path.join(ROOT, "node_modules", "@splunk", "visualizations");

if (!fs.existsSync(MARKER)) process.exit(0);
if (fs.existsSync(SPLUNK_DIR)) process.exit(0);

const SPLUNK_PKGS = [
  "@splunk/visualizations",
  "@splunk/visualization-context",
  "@splunk/visualization-themes",
  "@splunk/themes",
];

console.log("Restoring Splunk visualization packages (opted-in locally)...");

// Temporarily strip peerDependencies to avoid npm arborist bug, same as
// install-splunk-viz does.
const pkgPath = path.join(ROOT, "package.json");
const pkgOriginal = fs.readFileSync(pkgPath, "utf-8");
const pkg = JSON.parse(pkgOriginal);
for (const name of SPLUNK_PKGS) {
  if (pkg.peerDependencies) delete pkg.peerDependencies[name];
  if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
}
if (pkg.peerDependencies && Object.keys(pkg.peerDependencies).length === 0) delete pkg.peerDependencies;
if (pkg.peerDependenciesMeta && Object.keys(pkg.peerDependenciesMeta).length === 0) delete pkg.peerDependenciesMeta;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["install", "--no-save", ...SPLUNK_PKGS, "--legacy-peer-deps", "--ignore-scripts"],
  { cwd: ROOT, stdio: "inherit" }
);

// Always restore original package.json
fs.writeFileSync(pkgPath, pkgOriginal);

if (result.status !== 0) {
  console.warn("Could not restore Splunk visualizations. Run `node bin/opsblaze.cjs install-splunk-viz` to retry.");
}
