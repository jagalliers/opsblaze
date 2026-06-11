# Agent Bootstrap: AI-Powered Narrative Investigation Web App

> **Last verified: 2026-06-11.** If this is more than a few sessions stale, audit sections 3-5 and 8-9 against the actual codebase before relying on them.

This document is for quickly bootstrapping a new agent instance into this project.

## 1) Rename-Safe Naming Convention

To avoid confusion during project renames, use these aliases in reasoning and docs:

- `APP` = this web application (current package name is `opsblaze`)
- `SERVER` = backend Express app in `server/`
- `CLIENT` = React/Vite frontend in `src/`
- `MCP_SERVER` = Splunk MCP server in `mcp-server/`

When discussing current file paths, use real paths. When discussing product identity, prefer `APP`.

## 2) What This App Does

`APP` is a standalone Splunk investigation interface:

- user asks an analytical question
- model narrates findings
- model calls the `splunk_query` MCP tool to run SPL against Splunk
- backend streams text + chart events via SSE
- frontend renders narrative text and inline Splunk visualizations

## 3) Current Tech Stack

- Backend: Node + Express 5 + TypeScript (`server/`)
- Frontend: React 18 + Vite + Tailwind (`src/`)
- Agent runtime: `@anthropic-ai/claude-agent-sdk` (Claude Agent SDK)
- Model: Claude (configurable via `CLAUDE_MODEL` env var)
- Auth: Claude CLI OAuth (default) or optional `ANTHROPIC_API_KEY`
- MCP Server: `mcp-server/` — Splunk query + data transform via `@modelcontextprotocol/sdk`
- Charts: Chart.js (default) or `@splunk/visualizations` (optional, auto-detected at build time)
- Transport: SSE from `/api/chat`
- Skills: `.claude/skills/` — auto-discovered, toggleable from the UI
- License: Apache-2.0

## 4) Current Project Structure (Important Files)

### Tooling & Deployment
- `bin/setup.cjs` - interactive first-run setup wizard; detects running services and offers to stop them before proceeding
- `bin/opsblaze.cjs` - service controller with built-in supervisor (start/stop/restart/status/logs); stale-build detection (auto-rebuild when sources are newer than dist), graceful port sweep (SIGTERM → wait → SIGKILL)
- `bin/supervisor.cjs` - production daemon: daemonizes server, auto-restarts on crash with exponential backoff, log file management
- `package.json` - scripts/dependencies (Apache-2.0, Splunk viz as optional peerDeps)

### Server
- `server/index.ts` - server startup, Express routes (chat, conversations, MCP servers, skills, health, settings), SSE wiring, duplicate-shutdown guard, `.env` permission check
- `server/env.ts` - environment variable validation (`validateEnv`)
- `server/agent.ts` - `runAgent()`: invokes Claude Agent SDK `query()`, MCP server config, optional recording, skill scoping (`PreToolUse` hook for strict mode)
- `server/pipeline.ts` - message stream processing loop (extracted for testability and replay); deferred skill emission in strict mode; `classifyAgentError` for user-facing error messages (auth, rate limit, network, timeout)
- `server/sse-helpers.ts` - SSE formatting, chart validation, text buffer processing
- `server/recorder.ts` - JSONL recording of SDK message streams for replay testing
- `server/conversations.ts` - file-based conversation persistence (CRUD, search, listing)
- `server/mcp-config.ts` - user MCP server configuration persistence (CRUD), security blocklists for args/env
- `server/mcp-probe.ts` - runtime MCP server connectivity probe (test endpoint)
- `server/health.ts` - health check logic: Splunk connectivity probe + Claude auth validation (CLI or API key)
- `server/runtime-settings.ts` - runtime settings persistence (`data/runtime-settings.json`): model, effort, max turns, stream timeout; hot-reloadable without server restart
- `server/telemetry/index.ts` - TelemetryService singleton, exporter registry, emit/flush/shutdown lifecycle
- `server/telemetry/splunk-hec.ts` - Splunk HEC exporter with batched event shipping
- `server/telemetry/otel.ts` - OpenTelemetry span exporter via OTLP/HTTP
- `server/skills.ts` - skill discovery, toggle, YAML front-matter parsing, `validateSkillsParam` input validation
- `server/skill-extractor.ts` - skill distillation from conversations (`extractSkill`, `refineSkill`)
- `server/export.ts` - conversation export to standalone HTML (`renderExportHtml`)
- `server/logger.ts` - structured logging with pino
- `server/types.ts` - SSE/chart type definitions

### MCP Server
- `mcp-server/index.ts` - MCP server entry point, `splunk_query` tool definition
- `mcp-server/splunk-client.ts` - Splunk REST query execution and response parsing (uses scoped undici `Agent` for TLS skip)
- `mcp-server/spl-safety.ts` - SPL normalization, command allowlisting, subsearch validation
- `mcp-server/config/safe-spl.json` - allowlisted SPL commands
- `mcp-server/transform.ts` - Splunk `json_cols` -> visualization `dataSources`
- `mcp-server/logger.ts` - lightweight level-gated logger (respects `LOG_LEVEL` env var, writes to stderr)
- `mcp-server/types.ts` - Splunk/MCP type definitions

### Skills
- `.claude/skills/` - auto-discovered skill directory; each subdirectory contains a `SKILL.md` (disabled skills use `.disabled` suffix)
- `.claude/skills/splunk-analyst/SKILL.md` - core investigation prompt and domain knowledge
- Additional skills are user-created via the Skill Distillation feature and stored here

### Frontend
- `src/main.tsx` - React entry point: ErrorBoundary, `createRoot`, mounts `App`
- `src/App.tsx` - top-level layout, owns `selectedSkills`/`allowAdditional` state (reset on conversation new/load/delete), wraps `sendMessage` for ChatView suggestion buttons
- `src/types.ts` - shared frontend types (`VizType`, `ChartBlock`, `TextBlock`, `SkillBlock`, `LimitBlock`)
- `src/hooks/useChat.ts` - chat state, stream handling, stop/cancel logic, skill scope routing (strict vs advisory), exports `buildSkillRequest` for testability
- `src/lib/sse.ts` - SSE parser for text/chart/skill/usage/context/error/limit/done events
- `src/lib/api.ts` - conversation CRUD, search, and export API client
- `src/lib/settings-api.ts` - runtime settings, MCP server, and skills management API client
- `src/components/ChatView.tsx` - main chat layout with sidebar integration
- `src/components/Header.tsx` - app header with health indicator, settings toggle, and skill distillation trigger
- `src/components/MessageBubble.tsx` - message rendering: markdown, charts, SPL expander, used-skills badges, streaming indicator
- `src/components/SplunkChart.tsx` - chart dispatcher: selects renderer via build-time `__SPLUNK_VIZ_AVAILABLE__` flag
- `src/components/ChartJSRenderer.tsx` - Chart.js React renderer (default, handles all viz types)
- `src/components/SplunkVizRenderer.tsx` - Splunk native viz renderer (optional, used when `@splunk/visualizations` is installed)
- `src/components/Sidebar.tsx` - conversation list sidebar with create/switch/delete and search
- `src/components/UsageBar.tsx` - token usage display (in/out, cache read/write, cost) and context window progress bar with color-coded thresholds
- `src/components/InputBar.tsx` - input UI, submit behavior, hosts SkillPicker and UsageBar
- `src/components/SkillPicker.tsx` - portal-based skill picker with search, chip selection, keyboard navigation (Arrow/Enter/Escape), "Include additional skills" toggle for strict vs advisory mode
- `src/components/SettingsPanel.tsx` - settings UI with three tabs: General (system status + runtime model/effort/max turns/timeout), MCP Servers, Skills
- `src/components/SkillExtractor.tsx` - skill distillation modal (extract from conversation, refine, save)

### Config
- `.env.example` - required environment variables
- `LICENSE` - Apache-2.0 license

## 5) Runtime Commands

> **Process management SOP** is enforced by `.cursor/rules/process-management.mdc` (always-applied). See that file for the full list of allowed commands, prohibited patterns, and dev-mode notes.

### Quick Reference
- First-time setup: `node bin/setup.cjs`
- Dev mode: `node bin/opsblaze.cjs dev` (Vite at `:5173`, server at `:3000`)
- Production: `node bin/opsblaze.cjs start` / `stop` / `restart` / `status` / `logs`
- Health check: `node bin/opsblaze.cjs check` (validates Node, `.env`, Claude CLI, build, port)
- Splunk viz: `node bin/opsblaze.cjs install-splunk-viz` (installs optional `@splunk/visualizations`)

### Splunk Packages and npm Operations

The optional `@splunk/visualizations` packages are managed outside the lockfile by `bin/postinstall.cjs`. Any npm tree reconciliation command (`npm audit fix`, `npm update`, `npm dedupe`) will strip them from `node_modules`. **Always run `npm install` after these commands** to trigger the postinstall script that restores them. The marker file `data/.splunk-viz-enabled` controls whether postinstall restores the packages (present = restore, absent = skip).

The `overrides` field of `package.json` carries two kinds of transitive pins:

- **Security pins**: `lodash`, `path-to-regexp`, and `shell-quote`. The `shell-quote` pin must stay as long as `concurrently@9` is in use — it pins a vulnerable `shell-quote` version exactly, and `concurrently@10` requires Node >= 22 (above this repo's Node 20 support floor).
- **Supply-chain cooldown pins** (`protobufjs`, `hono`, `ast-v8-to-istanbul`, `acorn`, `import-in-the-middle`): added 2026-06-11 solely because the then-latest fixed versions had been published within the previous 72 hours. Safe to relax once newer versions have aged past the cooldown window.

### Mode Transitions

Both `start` and `dev` automatically stop the other mode first — you never need an explicit `stop` before switching.

| From | To | Command |
|------|----|---------|
| Stopped | Dev | `dev` |
| Stopped | Prod | `start` |
| Dev | Stopped | `stop` |
| Prod | Stopped | `stop` |
| Dev | Prod | `start` (auto-stops dev) |
| Prod | Dev | `dev` (auto-stops prod) |
| Dev | Dev | `restart` (preserves mode) |
| Prod | Prod | `restart` (preserves mode) |

`restart` preserves the current mode. If no state file exists, it defaults to prod. `stop` cleans up both tracked processes and orphans on ports 3000/5173.

### API
- Health: `GET /api/health` (returns `{ status, checks: { splunk, claude } }`)
- Chat stream: `POST /api/chat` (SSE response)
- Conversations: `GET/POST/PUT/DELETE /api/conversations`
- Conversation search: `GET /api/conversations/search?q=`
- Conversation export: `GET /api/conversations/:id/export` (standalone HTML)
- Conversation cleanup: `POST /api/conversations/cleanup`
- Config paths: `GET /api/config-paths` (returns MCP config file and skills directory paths)
- Settings: `GET /api/settings` (runtime model/effort/maxTurns/streamTimeoutMs + system info), `PATCH /api/settings` (update runtime settings without restart)
- MCP servers: `GET/POST/PUT/DELETE /api/mcp-servers`, `POST /api/mcp-servers/:name/toggle`, `POST /api/mcp-servers/:name/test`
- Skills: `GET /api/skills`, `POST /api/skills`, `POST /api/skills/:name/toggle`, `DELETE /api/skills/:name`
- Skill distillation: `POST /api/skills/extract`, `POST /api/skills/refine`

## 6) Environment & Auth Model

All env vars are documented in `.env.example`. The full set with defaults:

### Splunk Connection

- `SPLUNK_HOST` — required
- `SPLUNK_PORT` (default `8089`)
- `SPLUNK_SCHEME` (`https` default)
- either:
  - `SPLUNK_TOKEN`, or
  - `SPLUNK_USERNAME` + `SPLUNK_PASSWORD`
- `SPLUNK_VERIFY_SSL` (`true` default; set `false` for local/self-signed)
- `SPLUNK_TIMEOUT_MS` (default `60000`) — MCP server query timeout

### Claude Auth

**Default**: Uses Claude CLI OAuth (Claude Pro/Max subscription).
1. Install Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
2. Run `claude auth login` in a terminal and complete the OAuth flow
3. Credentials are stored in `~/.claude/` and used automatically by the Agent SDK

**Alternative**: Set `ANTHROPIC_API_KEY` in `.env` for API key auth (pay-per-use billing).
If `ANTHROPIC_API_KEY` is set, it takes precedence over CLI OAuth.

Optional: set `CLAUDE_MODEL` in `.env` to override the default model (default: `claude-opus-4-6`).
Optional: set `CLAUDE_EFFORT` to `low`, `medium`, `high`, or `max` (default: `high`) to control adaptive thinking depth.

### Server

- `PORT` (default `3000`)
- `HOST` (default `127.0.0.1`; use `0.0.0.0` for LAN access)
- `OPSBLAZE_ALLOWED_ORIGINS` — comma-separated CORS origins (default: `http://localhost:5173,http://localhost:3000`)
- `OPSBLAZE_RATE_LIMIT` — max requests/minute/IP to `/api/chat` (default `10`)
- `OPSBLAZE_STREAM_TIMEOUT_MS` — default max SSE stream duration before abort (default `300000`); also configurable in Settings UI
- `OPSBLAZE_MAX_TURNS` — default max agent turns per request (default `30`); also configurable in Settings UI
- `OPSBLAZE_MAX_HISTORY` — max conversation exchanges sent to Claude (default `20`)
- `OPSBLAZE_MAX_MESSAGE_LEN` — max input message length in characters (default `10000`)

### Data & Diagnostics

- `OPSBLAZE_DATA_DIR` — conversation storage directory (default `./data/conversations`)
- `OPSBLAZE_RECORD_DIR` — when set, records SDK message streams as JSONL fixtures for replay testing
- `LOG_LEVEL` — controls verbosity for both Express (pino) and MCP server: `fatal`, `error`, `warn`, `info` (default), `debug`, `trace`

### Telemetry

- `SPLUNK_HEC_URL` — Splunk HEC endpoint (e.g., `https://splunk.local:8088`); both URL and TOKEN required to enable
- `SPLUNK_HEC_TOKEN` — HEC authentication token
- `SPLUNK_HEC_INDEX` (default `main`), `SPLUNK_HEC_SOURCE` (default `opsblaze`), `SPLUNK_HEC_SOURCETYPE` (default `opsblaze:agent`)
- `SPLUNK_HEC_VERIFY_SSL` (default `true`), `SPLUNK_HEC_BATCH_SIZE` (default `10`), `SPLUNK_HEC_FLUSH_MS` (default `5000`)
- `OTEL_ENABLED` (default `false`) — enable OpenTelemetry trace export
- `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4318`) — OTLP/HTTP collector endpoint
- `OTEL_SERVICE_NAME` (default `opsblaze`)

### MCP Server

- `MAX_ROW_LIMIT` — max rows returned from Splunk queries (default `10000`)
- `SPL_SAFETY_ENABLED` — enable/disable SPL command allowlisting (default `true`)

## 7) Architecture Overview

### Data Flow

```
Browser <-- SSE (text, chart, skill, usage, context, error, limit, done) --> Express Server
                                                    |
                                          Claude Agent SDK query()
                                                    |
                                              Claude API
                                                    |
                                          MCP tool call (stdio)
                                                    |
                                          Splunk MCP Server
                                                    |
                                          Splunk REST API
```

### How Chart Data Reaches the Browser

1. Claude calls the `splunk_query` MCP tool
2. MCP server runs SPL, transforms data, returns JSON with `summary` + `chart` (dataSources)
3. Express server intercepts the tool result from the Agent SDK message stream
4. Chart data is extracted and emitted as an SSE `chart` event to the browser
5. Only the text summary is used by Claude for its next reasoning step
6. Browser renders interactive charts using Chart.js (default) or `@splunk/visualizations` (if installed)

### MCP Server Design

The MCP server (`mcp-server/`) is a standalone stdio-transport MCP server that:
- Accepts `splunk_query` tool calls with SPL, viz_type, time range, and dimensions
- Executes queries against Splunk's REST API
- Transforms `json_cols` results to `dataSources` format
- Returns structured JSON (`SplunkToolResult`) with both chart data and text summary
- Suppresses chart data for diagnostic/helper queries (min/max time patterns)

### Skills

Skills are Claude-compatible markdown files (`.claude/skills/*/SKILL.md`) with YAML front-matter for metadata. The system auto-discovers all skills in the `.claude/skills/` directory and injects enabled skills into the agent's system prompt at inference time.

The core skill (`splunk-analyst`) includes:
- Narrative investigation structure (journalistic arc)
- Visualization selection guidance
- Splunk domain knowledge (system indexes, SPL patterns)
- Writing style guidelines

Skills are managed via the Settings panel in the UI (`/api/skills` endpoints). Users can toggle individual skills on/off. The pipeline emits a `skill` SSE event for each skill the model invokes during a turn, and the UI renders used-skill badges on messages.

#### Skill Scoping

Users can scope which skills the model is allowed to use per-request via the SkillPicker in the InputBar:

- **Advisory mode** (toggle ON — "Include additional skills"): Selected skill names are prepended to the prompt text as a hint. The model can still use other skills.
- **Strict mode** (toggle OFF): The frontend sends `skills: string[]` in the POST body. The backend installs a `PreToolUse` hook (matcher: `"Skill"`) that denies any skill not in the allowed set and appends a system prompt directive. The pipeline defers `skill` SSE events in strict mode, buffering them in `pendingSkills` and draining at two points: (1) on `hook_response` system messages, and (2) at user turn boundaries (`message.type === "user"`) to handle SDKs that don't emit hook_response (e.g. `bypassPermissions` mode). Denied skills are suppressed; allowed skills are emitted. A final sweep catches any remaining pending skills at stream end. The frontend prepends skill blocks so they always render at the top of the chat regardless of arrival time.

### Skill Distillation

Users can create new skills from completed investigations. The flow:
1. User clicks the lightbulb icon in the header on a conversation
2. `POST /api/skills/extract` sends conversation messages to Claude with a structured extraction prompt
3. The model returns a draft skill (title, description, content) based on the investigation patterns
4. User can refine via `POST /api/skills/refine` with natural-language feedback
5. Saving writes the skill to `.claude/skills/<slug>/SKILL.md` with proper YAML front-matter
6. A Claude Code prompt is also provided so the user can optionally invoke Anthropic's skill-builder for deeper eval

### MCP Server Management

Users can add, edit, toggle, and test custom MCP servers from the Settings panel. Configuration is persisted in `data/mcp-servers.json`. User-defined servers are merged with the built-in Splunk MCP server at agent query time.

User-configured stdio MCP servers are validated against security blocklists:
- **Blocked arguments**: `--require`, `--eval`, `--import`, `--loader`, `-e`, `-r`, `-c`, `--experimental-loader` (prevents code injection via spawned processes).
- **Blocked env vars**: `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, `PYTHONSTARTUP`, `PYTHONPATH`, `RUBYOPT`, `PERL5OPT`, `BASH_ENV`, `ENV` (prevents environment-based code injection).

## 8) SSE Event Contract

The SSE stream from `/api/chat` emits these events:

| Event | Data | Description |
|-------|------|-------------|
| `text` | `{ content: string }` | Text delta from the model |
| `chart` | `{ vizType, dataSources, width, height, spl?, earliest?, latest? }` | Interactive chart data |
| `skill` | `{ skill: string }` | Name of a skill the model invoked during this turn |
| `usage` | `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalCostUsd, modelUsage }` | Token usage and cost for the query |
| `context` | `{ totalTokens, maxTokens, percentage, categories }` | Context window utilization |
| `error` | `{ message: string }` | Error message (auth, network, timeout, etc.) |
| `limit` | `{ reason: "max_turns" \| "stream_timeout", message: string, setting: string }` | Investigation hit a configurable limit; rendered as inline notice with settings reference |
| `done` | `{}` | Stream complete |

## 9) Testing

Run the full test suite:

```
npm test
```

Tests use Vitest (config in `vitest.config.ts`, includes `**/__tests__/**/*.test.{ts,tsx}`). A shared setup file (`src/test/setup.ts`, registered via `setupFiles`) polyfills `localStorage` for jsdom tests on Node >= 25, where Node's experimental WebStorage global otherwise shadows jsdom's implementation with `undefined`.

### Test Files

#### Server tests (`server/__tests__/`)
- `pipeline-replay.test.ts` - deterministic replay of recorded SDK message streams (see Recording below)
- `pipeline-skill-denial.test.ts` - strict-mode skill denial, pending-skill draining at turn boundaries
- `chat-skill-validation.test.ts` - `validateSkillsParam` input validation (type checks, empty arrays, unknown/disabled skills)
- `skills.test.ts` - skill discovery and toggle logic
- `sse-helpers.test.ts` - SSE formatting and text buffer processing
- `conversations.test.ts` - conversation persistence CRUD
- `env.test.ts` - environment variable validation
- `health.test.ts` - Splunk/Claude health check probes (status codes, auth headers, timeouts, overall status derivation)
- `runtime-settings.test.ts` - runtime settings load/update/defaults, model and effort resolution
- `pipeline-usage.test.ts` - usage and context event emission from the pipeline
- `telemetry-service.test.ts` - TelemetryService singleton, exporter lifecycle, emit/flush
- `splunk-hec.test.ts` - Splunk HEC exporter batching, flush, error handling
- `mcp-config.test.ts` - MCP server configuration CRUD, security blocklist validation
- `export.test.ts` - conversation export to standalone HTML
- `skill-extractor.test.ts` - skill draft parsing from YAML frontmatter
- `recorder.test.ts` - JSONL message stream recording

#### MCP server tests (`mcp-server/__tests__/`)
- `spl-safety.test.ts` - SPL normalization and command allowlisting
- `transform.test.ts` - Splunk `json_cols` to `dataSources` transformation
- `splunk-client.test.ts` - Splunk REST client configuration and query execution

#### Frontend tests (`src/`)
- `src/components/__tests__/SkillPicker.test.tsx` - SkillPicker rendering, keyboard navigation, chip selection
- `src/components/__tests__/InputBar.test.tsx` - InputBar submit behavior, skill scope wiring
- `src/components/__tests__/UsageBar.test.tsx` - UsageBar rendering, token formatting, context bar thresholds
- `src/components/__tests__/SettingsPanel.test.tsx` - SettingsPanel controls, save behavior, input clamping
- `src/components/__tests__/MessageBubble.test.tsx` - MessageBubble rendering including LimitBlock notices
- `src/hooks/__tests__/useChat-skills.test.ts` - `buildSkillRequest` advisory vs strict routing
- `src/hooks/__tests__/useChat-limits.test.ts` - usage/context/limit state management and conversation reset
- `src/lib/__tests__/sse.test.ts` - SSE parser event handling including `skills` param and `limit` events
- `src/lib/__tests__/sse-usage.test.ts` - SSE parser usage and context event parsing
- `src/lib/__tests__/api.test.ts` - conversation CRUD, search, and export API client
- `src/lib/__tests__/settings-api.test.ts` - MCP server and runtime settings API client
- `src/__tests__/App.test.tsx` - App-level skill state reset on conversation new/load/delete

Frontend component tests use `@testing-library/react`, `@testing-library/user-event`, and `jsdom`.

### SDK Message Recording

The pipeline supports recording raw SDK message streams from live agent runs for replay testing:

1. Set `OPSBLAZE_RECORD_DIR=./fixtures` in your `.env` file
2. Run an investigation in the browser as normal
3. Each agent run saves a JSONL fixture file to the directory (timestamped with request ID)
4. Unset `OPSBLAZE_RECORD_DIR` to stop recording

The replay tests feed each fixture through `processMessageStream()` and assert invariants:
- Pipeline completes without throwing
- At least one text event is emitted
- No text event contains raw `<chart>` tags
- All chart events have valid dataSources

To preserve a recording as a named regression test, rename it descriptively:
```
mv fixtures/2026-02-25T00-15-00-000Z_abc12345.jsonl server/__tests__/fixtures/ssh-brute-force.jsonl
```

### Architecture

The pipeline logic lives in `server/pipeline.ts` as a pure function (`processMessageStream`) that takes an async iterable of SDK messages and an emitter callback. This same function is used by both the live server and the replay tests, so test coverage directly validates production behavior.

## 10) Known Limitations

1. The Agent SDK manages MCP tool execution internally. Chart data is extracted from the structured JSON tool result as it flows through the message stream.
2. Claude Max subscription rate limits apply to all inference when using CLI OAuth. API key billing applies when using `ANTHROPIC_API_KEY`.
3. `@splunk/visualizations` is proprietary and cannot be redistributed. It is an optional peer dependency; Chart.js is the default renderer.
4. Conversation export produces a self-contained HTML file (not PDF). Chart data is re-rendered client-side via Chart.js in the export.

## 11) First 30 Minutes Checklist for a New Agent

1. Verify Claude Code auth works (`claude --version` and check credentials exist).
2. Verify server health (`/api/health`).
3. Verify simple chat stream (`Say hello`) returns `text` + `done`.
4. Verify one tool call emits a `chart` event.
5. Verify footer shows "OpsBlaze" (idle) or fire-animated "OpsBlaze" (streaming).
6. Verify login-specific prompt behavior via the skill (does it stay scoped to `action=login_attempt`?).

## 12) GitHub & Release Workflow

The project is hosted at https://github.com/jagalliers/opsblaze. CI runs automatically on every push to `main` and on every pull request.

### Pushing Changes

After committing locally, push to the remote:

```
git push
```

This triggers the CI pipeline (GitHub Actions), which runs typecheck, lint, tests (with coverage), and build across Node 20, 22, 24, and 26.

### Branch Workflow

For solo development, pushing directly to `main` is fine. When collaborating or making larger changes, use feature branches:

```
git checkout -b feature/my-change
# ... make changes, commit ...
git push -u origin feature/my-change
# Open a PR on GitHub — CI runs automatically on the PR
# Merge into main once CI passes
```

### Cutting a New Release

1. Update `CHANGELOG.md` with the new version's changes under a new `## [x.y.z] - YYYY-MM-DD` heading and add a link reference at the bottom.
2. Bump the version in `package.json`.
3. Commit, push, and wait for CI to pass.
4. Tag and publish:

```
git tag vX.Y.Z
git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file CHANGELOG.md
```

### CI Pipeline

Defined in `.github/workflows/ci.yml`. Runs on `ubuntu-latest` with a matrix of Node 20, 22, 24, and 26:

1. `npm ci`
2. `npm audit --audit-level=high`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run test:coverage`
6. `npm run build`

Note the audit step gates CI at `--audit-level=high`: any unfixed high/critical advisory in the dependency tree fails every push and PR.

### Dependency Update Policy

Dependency updates flow through Dependabot (`.github/dependabot.yml`): weekly npm and github-actions checks with a supply-chain cooldown — new versions must be at least 7 days old (14 days for semver-majors) before a PR is opened. Minor/patch npm updates arrive grouped; security updates bypass the cooldown.

When reviewing a Dependabot PR (or making any dependency change), remember:

- Dependabot's cooldown only covers packages it bumps **directly**. A direct bump can re-resolve transitive dependencies to versions published hours ago. Scan the lockfile diff before merging: publish age of every changed version (`npm view <pkg> time --json`), `resolved` URLs all on `registry.npmjs.org`, no surprise `bin` or install-script entries.
- Use `npm ci` for routine installs; reserve `npm install` for deliberate dependency changes.
- Never run blanket `npm audit fix --force` — fix advisories with targeted, cooldown-checked upgrades instead.
- Do not take `concurrently@10` (requires Node >= 22) while Node 20 remains in the support matrix.
