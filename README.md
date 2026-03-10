# OpsBlaze

[![CI](https://github.com/jagalliers/opsblaze/actions/workflows/ci.yml/badge.svg)](https://github.com/jagalliers/opsblaze/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

AI-driven narrative investigation for Splunk. Ask questions in natural language, and OpsBlaze queries your Splunk instance, analyzes the results, and presents findings as a rich narrative with interactive charts.

Powered by Claude (via the Claude Agent SDK). Connects to Splunk via its REST API.

## Supported Platforms

| Platform | Status |
|---|---|
| macOS (Apple Silicon & Intel) | Fully supported |
| Linux (x64, arm64) | Fully supported |

## Prerequisites

| Requirement | How to get it |
|---|---|
| Node.js 20+ | [nodejs.org](https://nodejs.org) |
| Claude auth | Claude CLI (`npm install -g @anthropic-ai/claude-code` then run `claude auth login`) **or** an [Anthropic API key](https://console.anthropic.com/) |
| Splunk access | Management port (default 8089) |

The Claude CLI uses OAuth with a Claude Pro/Max subscription. Alternatively, set `ANTHROPIC_API_KEY` in `.env` for pay-per-use API billing.

## Quick Start

```bash
# 1. Install and configure
node bin/setup.cjs

# 2. Start the server
node bin/opsblaze.cjs start

# 3. Open in your browser
open http://localhost:3000
```

The setup wizard walks you through connecting to Splunk, setting the server port, and optionally securing the API endpoint.

## Commands

All commands are run from the project root:

| Command | Description |
|---|---|
| `node bin/opsblaze.cjs start` | Start the server in production mode (daemonized) |
| `node bin/opsblaze.cjs stop` | Stop the server |
| `node bin/opsblaze.cjs restart` | Restart the server |
| `node bin/opsblaze.cjs status` | Show PID, uptime, memory, restart count |
| `node bin/opsblaze.cjs logs` | Tail server logs |
| `node bin/opsblaze.cjs check` | Validate environment and prerequisites |
| `node bin/opsblaze.cjs dev` | Start in development mode with hot reload |
| `node bin/opsblaze.cjs install-splunk-viz` | Install optional Splunk visualization packages |
| `node bin/setup.cjs` | Re-run the setup wizard |

## Visualizations

OpsBlaze uses **Chart.js** by default for rendering charts (line, area, bar, column, pie, single value, and table). No additional setup is required.

### Optional: Splunk Native Visualizations

If you have access to the `@splunk/visualizations` npm packages, you can install them for a premium chart experience:

```bash
node bin/opsblaze.cjs install-splunk-viz
```

This installs the `@splunk/visualizations` packages and rebuilds the app. The change is automatic -- the app detects which renderer is available at build time and uses it. To switch back to Chart.js, uninstall the Splunk packages and rebuild.

The setup wizard also offers this as an optional step during initial configuration.

> **Note:** The `@splunk/*` visualization packages are proprietary software published by Splunk Inc. and are subject to Splunk's own license terms. They are not included in or distributed with OpsBlaze. You are responsible for ensuring you have appropriate licensing before installing them.

## Configuration

All configuration lives in `.env` (created by the setup wizard). Key variables:

| Variable | Default | Description |
|---|---|---|
| `SPLUNK_HOST` | — | Splunk management host (required) |
| `SPLUNK_PORT` | `8089` | Splunk management port |
| `SPLUNK_SCHEME` | `https` | `https` or `http` |
| `SPLUNK_TOKEN` | — | Bearer auth token (use this or username/password) |
| `SPLUNK_USERNAME` | — | Splunk username (alternative to token) |
| `SPLUNK_PASSWORD` | — | Splunk password (alternative to token) |
| `SPLUNK_VERIFY_SSL` | `true` | Verify Splunk's SSL certificate |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (optional alternative to Claude CLI) |
| `PORT` | `3000` | Server port |
| `HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` for LAN access) |
| `OPSBLAZE_RATE_LIMIT` | `10` | Max chat requests per minute per IP |
| `OPSBLAZE_STREAM_TIMEOUT_MS` | `300000` | Max streaming duration (5 minutes) |
| `CLAUDE_MODEL` | `claude-opus-4-6` | Claude model to use |
| `CLAUDE_EFFORT` | `high` | Thinking effort: `low`, `medium`, `high`, or `max` |
| `LOG_LEVEL` | `info` | Log verbosity: `fatal`, `error`, `warn`, `info`, `debug`, or `trace` |

See `.env.example` for the complete list of all available options with inline descriptions.

To configure manually instead of using the wizard, copy `.env.example` to `.env` and fill in the required values.

## Troubleshooting

Run `node bin/opsblaze.cjs check` first -- it validates your entire setup in one shot.

### Port 3000 already in use

Another process is using the port. Either stop it, or change `PORT` in `.env`:

```bash
# Find what's using it
lsof -i :3000
```

Or edit `.env` and change the `PORT` value to a different port (e.g. `PORT=3001`).

### Claude CLI not authenticated

If you see "Claude CLI not found or not authenticated" at startup:

```bash
# Install the CLI
npm install -g @anthropic-ai/claude-code

# Authenticate (opens browser for OAuth)
claude
```

Alternatively, set `ANTHROPIC_API_KEY` in `.env` to use API key authentication instead of the CLI.

### Splunk connection refused

Verify your Splunk settings in `.env`:
- Is the host reachable? `curl -k https://your-splunk-host:8089/services/server/info`
- Is the port correct? Default management port is 8089, not 8000.
- Are credentials valid? Try logging into Splunk's web UI with the same credentials.

### Build not found

If the server can't find the frontend:

```bash
npm run build
node bin/opsblaze.cjs restart
```

### App starts but page is blank

- Clear your browser cache and hard-refresh (Cmd+Shift+R / Ctrl+Shift+R)
- Verify the build completed: check that `dist/client/index.html` exists

## Development

For active development with hot reload:

```bash
node bin/opsblaze.cjs dev
```

This starts both the Vite dev server (http://localhost:5173) and the Express backend (http://localhost:3000). Work from port 5173 -- Vite proxies API calls to the backend automatically.

Running `dev` will automatically stop a running production server, and vice versa.

## Security

OpsBlaze includes several layers of security hardening:

- **Rate limiting** -- Per-IP rate limits on chat, API, and skill extraction endpoints.
- **Content Security Policy** -- Strict CSP with `frame-ancestors 'none'`, no `unsafe-eval`.
- **SPL safety validation** -- Allowlist-based SPL command validation prevents dangerous Splunk queries.
- **MCP server sandboxing** -- Blocklists reject dangerous arguments (`--require`, `--eval`) and environment variables (`NODE_OPTIONS`, `LD_PRELOAD`) in user-configured MCP servers.
- **Error sanitization** -- API error responses only surface known validation messages, preventing internal detail leakage.

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Open an issue first to discuss what you'd like to change, then submit a pull request.

## Trademarks

Splunk is a registered trademark of Splunk Inc. in the United States and other countries. Splunk Inc. is a wholly owned subsidiary of Cisco Systems, Inc. This project is not affiliated with, endorsed by, or sponsored by Splunk Inc. or Cisco Systems, Inc.

All other trademarks are the property of their respective owners.

## Author

**Jesse Galliers** -- [@jagalliers](https://github.com/jagalliers)

## License

Licensed under the [Apache License 2.0](LICENSE).
