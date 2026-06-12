# Changelog

All notable changes to OpsBlaze will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Fixed all 18 open npm audit findings (5 critical, 4 high, 9 moderate), including vitest UI server file read/execute, protobufjs code execution, shell-quote command injection, and the `@anthropic-ai/sdk` memory tool sandbox escape. `npm audit` is now clean.
- Updated `@opentelemetry/sdk-node` 0.214 -> 0.218 to fix a Prometheus exporter crash via malformed HTTP request (GHSA-q7rr-3cgh-j5r3).
- Added Dependabot with a supply-chain cooldown policy: new dependency versions must be at least 7 days old (14 for semver-majors) before update PRs are opened.
- Proprietary `@splunk/*` visualization packages can no longer leak into the committed lockfile: `install-splunk-viz` now installs with `--no-save`, and a new guard (`bin/check-splunk-viz.cjs`) fails CI if they appear in `package.json` or `package-lock.json`, with a postinstall warning on the machine where contamination occurs.

### Fixed

- Test suite failures on Node >= 25, where Node's experimental WebStorage `localStorage` global shadowed jsdom's implementation; a vitest setup shim now provides an in-memory `localStorage` when needed.

### Changed

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
