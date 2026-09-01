# Changelog

All notable changes to OpsBlaze will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Fixed two high-severity esbuild advisories (GHSA-gv7w-rqvm-qjhr remote code execution via `NPM_CONFIG_REGISTRY` in Deno contexts, GHSA-g7r4-m6w7-qqqr arbitrary file read via the dev server on Windows): tsx's esbuild updated in-range to the patched 0.28.1, and Vite upgraded 6 -> 8 (with vitest 4.1 and `@vitejs/plugin-react` 6) since no patched esbuild exists for the Vite 6 dependency range — Vite 8 no longer uses esbuild at all.
- Fixed all 18 open npm audit findings (5 critical, 4 high, 9 moderate), including vitest UI server file read/execute, protobufjs code execution, shell-quote command injection, and the `@anthropic-ai/sdk` memory tool sandbox escape. `npm audit` is now clean.
- Updated `@opentelemetry/sdk-node` 0.214 -> 0.218 to fix a Prometheus exporter crash via malformed HTTP request (GHSA-q7rr-3cgh-j5r3).
- Added Dependabot with a supply-chain cooldown policy: new dependency versions must be at least 7 days old (14 for semver-majors) before update PRs are opened.
- Proprietary `@splunk/*` visualization packages can no longer leak into the committed lockfile: both `install-splunk-viz` and the setup wizard (`bin/setup.cjs`) now install with `--no-save --ignore-scripts`, and a new guard (`bin/check-splunk-viz.cjs`) fails CI if they appear in `package.json` or `package-lock.json`, with a postinstall warning on the machine where contamination occurs.
- Cleared two newly-disclosed high-severity advisories that `npm audit --audit-level=high` (the CI gate) now flags on the existing dependency tree: bumped the `hono` override 4.12.24 -> 4.12.26 (fixes `serve-static` path traversal GHSA-wwfh-h76j-fc44 and related Hono advisories) and added an `undici` 7.28.0 override (transitive via the `jsdom` dev dependency only; fixes the SOCKS5 TLS-validation bypass GHSA-vmh5-mc38-953g and related undici advisories). Both patched versions are past the 7-day supply-chain cooldown; the change is targeted `overrides` only, avoiding the breaking `@anthropic-ai/claude-agent-sdk` downgrade that `npm audit fix --force` proposed.
- Cleared all open `npm audit` findings that accumulated while the repo sat idle June–September (10 high plus moderates/lows, ~40 total; the CI `npm audit --audit-level=high` gate had gone red, which also wedged every open Dependabot PR at the audit step). Highlights: five undici advisories including response desynchronization via the retry interceptor (GHSA-8xcm-r25x-g524) and CRLF injection via a blob-like body type (GHSA-m8rv-5g2x-5cg5), fixed by dropping the stale 7.28.0 override so jsdom's own `^7.25.0` resolves the patched 7.29.0; shell-quote quadratic-complexity DoS in `parse()` (GHSA-395f-4hp3-45gv) via concurrently 9.2.4, which exact-pins the patched shell-quote 1.9.0; the postcss `sourceMappingURL` path-traversal pair (GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp) via in-range 8.5.26; plus js-yaml 4.3.1, protobufjs 7.6.5 (GHSA-f38q-mgvj-vph7, GHSA-j3f2-48v5-ccww), hono 4.12.34, ip-address 10.3.1, fast-uri (GHSA-4c8g-83qw-93j6), nanoid, body-parser, `@babel/core` 7.29.7, `@modelcontextprotocol/sdk` 1.30.0, and `@hono/node-server` 2.1.1 — all in-range or override-pin changes, no majors of app libraries. `npm audit` is clean again.
- Restructured `overrides` from nine exact pins down to four (`protobufjs` 7.6.5, `hono` 4.12.34, `ip-address` 10.3.1, `import-in-the-middle` 3.3.3). Root cause of the audit decay was exact override pins rotting: four of the June pins had new advisories published against the pinned versions, and Dependabot never proposes changes to `overrides`. Pins whose dependents' own ranges already resolve to fixed versions were dropped (lodash, path-to-regexp, shell-quote, undici, acorn, ast-v8-to-istanbul); the four kept pins only hold resolution below releases still inside the 7-day supply-chain cooldown, and are documented in AGENT_BOOTSTRAP as a review-on-every-pass list.
- Updated the OpenTelemetry stack 0.218 -> 0.222 / 2.7 -> 2.11 (clears the ~20 moderate advisories across the OTLP exporter/sdk cluster, plus the high-severity propagator-jaeger one). The 0.222.0/2.11.0 releases were one day old at adoption and were taken under the cooldown policy's security-update exemption: holding the lock-step OTel 2.x cluster at an older fixed release would have required re-introducing a dozen exact-version overrides — the same decay pattern this change removes.

### Fixed

- Splunk visualizations silently fell back to Chart.js after the Vite 8 (rolldown) upgrade, even when the optional `@splunk/*` packages were installed. Rolldown surfaces the CommonJS default export of those packages double-wrapped (`{ default: Component }`) where Rollup unwrapped it, so each lazily-loaded chart component resolved to an object and threw React error #130 at render time, tripping the Chart.js fallback. `SplunkVizRenderer` now normalizes the CommonJS default export through a bundler-agnostic `interopDefault` unwrap (`src/components/splunkInterop.ts`) before handing components to React. This is the third recurrence of the same class of bug across bundler changes, so it is now guarded two ways: the Chart.js fallback logs a loud `console.error` when `@splunk` is installed but a chart fails to load or render (staying silent only when Splunk was never installed), and a regression test (`splunkInterop.test.tsx`) asserts every Splunk viz/theme default export unwraps to a component function — it runs automatically on any machine with `@splunk` installed and is skipped in CI. Verified end-to-end in a clean clone under the real Express server (production CSP, which still requires `script-src 'unsafe-eval'`) and in dev mode.
- Test suite failures on Node >= 25, where Node's experimental WebStorage `localStorage` global shadowed jsdom's implementation; a vitest setup shim now provides an in-memory `localStorage` when needed.
- Port-based process detection (`opsblaze status`/`stop`, the production supervisor's restart wait, and the setup wizard) now matches only the TCP LISTEN socket instead of any connection on the port. Previously an unrelated client holding an ESTABLISHED connection (e.g. an IDE attached to the Vite port) could be reported as a server PID and killed during orphan cleanup.
- The setup wizard (`bin/setup.cjs`) now writes the `data/.splunk-viz-enabled` marker after installing Splunk visualizations, so `postinstall` restores them after npm tree operations (`npm audit fix`/`update`/`dedupe`). Previously the wizard's install path diverged from `install-splunk-viz` — it used `--save` (leaking `@splunk` into the lockfile) and never wrote the marker, so Splunk viz silently disappeared after routine npm maintenance.

### Changed

- Claude Agent SDK updated 0.3.163 -> 0.3.245 (the newest release outside the 7-day supply-chain cooldown at update time), which also refreshes the SDK's bundled model registry (stale since 0.3.163 — see the HANDOFF note about Fable 5's context window being under-reported).
- Routine dependency refresh superseding the wedged Dependabot group PR: Vite 8.0.16 -> 8.2.2 (with rolldown held at 1.2.5 by a documented cooldown override — vite's `~1.2.4` range would float to the days-old 1.2.6), vitest and `@vitest/coverage-v8` 4.1.11, `@vitejs/plugin-react` 6.1.0, tsx 4.23.12, marked 18.0.11, express-rate-limit 8.6.2, prettier 3.9.6 (one formatting-only reflow in `server/pipeline.ts`), autoprefixer 10.5.4, `@testing-library/user-event` 14.6.6, `@types/node` 22.20.1, `@types/react` 18.3.31. Every adopted version was verified >= 7 days published; zod and `@testing-library/react` were deliberately left alone because only days-old releases were available. The browserslist data packages (caniuse-lite, electron-to-chromium, node-releases, baseline-browser-mapping, update-browserslist-db) float with autoprefixer, release near-daily, and are accepted as a documented cooldown exception — pinning them was attempted before (unmerged branch) and would recreate override rot at maximum velocity.
- Default Claude model updated from `claude-opus-4-6` to `claude-opus-4-8`.
- Default max turns per investigation raised from 30 to 120, and the default stream timeout from 5 to 15 minutes so longer investigations aren't cut off by the wall clock first. (A turn is one model response plus its tool results, not one tool call.)
- New `xhigh` thinking-effort level (introduced with Opus 4.7) is now accepted via `CLAUDE_EFFORT` and selectable in Settings. The default remains `high`.
- The model field in Settings now suggests current model IDs (including `claude-fable-5`) while still accepting any ID as free text.
- CI matrix extended to Node 26 (now 20/22/24/26); `actions/checkout` and `actions/setup-node` updated to v6.
- Routine dependency refresh via grouped Dependabot updates (Claude Agent SDK 0.3.x, dotenv, js-yaml, tsx, zod, autoprefixer, prettier, OpenTelemetry semantic-conventions).

## [0.1.0] - 2026-03-04

### Added

- Natural language Splunk investigation with Claude Agent SDK.
- Interactive chart rendering (line, area, bar, column, pie, single value, table).
- Conversation persistence with search, export (HTML), and cleanup.
- MCP (Model Context Protocol) server for Splunk queries with SPL safety validation.
- Skills system for extensible agent capabilities with extract/refine workflow.
- User-configurable MCP server management (add, edit, toggle, test, delete).
- Rate limiting on chat, API, and skill extraction endpoints.
- Bearer token authentication with timing-safe comparison.
- Environment validation via Zod schema at startup.
- CI pipeline with typecheck, lint, test, build, and dependency audit.
- Setup wizard (`node bin/setup.cjs`) for guided configuration.
- Port conflict detection with retry logic and process identification.
- Skill scoping (advisory and strict modes) with SkillPicker UI.
- Structured logging in MCP server via `LOG_LEVEL` env var (`fatal`/`error`/`warn`/`info`/`debug`/`trace`).
- Log rotation in production supervisor (10 MB per file, keeps 3 rotations).
- `OPSBLAZE_MODE=server` for remote deployments: enables HSTS, `trust proxy` for rate limiting behind reverse proxies.
- `.env` file permission check at startup (warns if group/other-readable).
- Test coverage for conversations, export, MCP config, recorder, skill extractor, API client, settings API, and Splunk client.

### Security

- Content Security Policy tightened: removed `unsafe-eval`, added `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- HSTS header (`Strict-Transport-Security`) when running in server mode.
- MCP server argument blocklist: rejects dangerous args (`--require`, `--eval`, `--import`, `--loader`).
- MCP server environment blocklist: rejects dangerous env vars (`NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, etc.).
- Error message sanitization: API responses only surface known validation messages, preventing internal detail leakage.
- Search query length limit (500 characters).
- Splunk TLS: replaced `NODE_TLS_REJECT_UNAUTHORIZED` override with scoped undici `Agent` for SSL skip.
- HTML export: Chart.js loaded with SRI hash; chart data escaped to prevent XSS injection.
- Markdown table rendering: defense-in-depth sanitization of event handlers, `javascript:` and `data:` URIs.

### Removed

- EC2/Caddy deployment infrastructure (`deploy/` directory, `ec2-bootstrap.sh`, `Caddyfile.template`). OpsBlaze runs as a local-first app; multi-user support will come with proper auth and user models. The `OPSBLAZE_MODE=server` env var is retained for security header and proxy trust configuration.
- Windows support. Process management relies on Unix-only APIs (`lsof`, process groups, `SIGKILL`, `tail`) that do not work on Windows. CLI entry points now exit with a clear message on `win32`.

[0.1.0]: https://github.com/jagalliers/opsblaze/releases/tag/v0.1.0
