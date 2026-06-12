#!/usr/bin/env node

// Guards against distributing the proprietary @splunk/* visualization
// packages. They are licensed separately by Splunk Inc. and must remain a
// local-only, opt-in install (`node bin/opsblaze.cjs install-splunk-viz`).
//
// The historical failure mode (commit 3300462, cleaned up in adada81): an npm
// tree operation on a machine with the packages installed records the entire
// @splunk dependency tree in package-lock.json, which is committed and
// public — making every `npm ci` auto-install proprietary software.
//
// This script fails if @splunk/* packages appear anywhere in package.json or
// package-lock.json other than the root peerDependencies/peerDependenciesMeta
// (intentional optional references). Run standalone or via CI.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const problems = [];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const PKG_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "overrides",
  "bundleDependencies",
  "bundledDependencies",
];
for (const field of PKG_FIELDS) {
  for (const name of Object.keys(pkg[field] || {})) {
    if (name.startsWith("@splunk/")) {
      problems.push(`package.json ${field} contains ${name}`);
    }
  }
}

const lock = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf-8")
);
for (const [key, entry] of Object.entries(lock.packages || {})) {
  if (key.includes("node_modules/@splunk/")) {
    problems.push(`package-lock.json contains entry "${key}"`);
    continue;
  }
  // The root entry ("") mirrors package.json; peerDependencies(+Meta) are the
  // only fields allowed to reference @splunk packages there.
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(entry[field] || {})) {
      if (name.startsWith("@splunk/")) {
        problems.push(
          `package-lock.json "${key || "(root)"}" ${field} contains ${name}`
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error("FAIL: proprietary @splunk visualization packages are tracked in the npm manifest/lockfile:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nThese packages are proprietary and must not be recorded where npm would" +
      "\nauto-install them for every user. To fix: restore a clean lockfile" +
      "\n(`git checkout -- package-lock.json` / `npm ci`) or remove the entries." +
      "\nLocal opt-in installs must use `node bin/opsblaze.cjs install-splunk-viz`."
  );
  process.exit(1);
}

console.log("OK: no proprietary @splunk packages in package.json or package-lock.json.");
