# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in OpsBlaze, please report it responsibly.

**Do not file a public issue for security vulnerabilities.**

Instead, please open a private security advisory through GitHub's [Security Advisories](https://github.com/jagalliers/opsblaze/security/advisories/new) feature, or contact the maintainer [@jagalliers](https://github.com/jagalliers) directly.

Include the following in your report:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix**: As soon as feasible, depending on severity

## Scope

The following are in scope:

- The OpsBlaze server (`server/`)
- The MCP server (`mcp-server/`)
- The frontend application (`src/`)
- Setup scripts (`bin/`)

The following are out of scope:

- Vulnerabilities in upstream dependencies (report to the respective projects)
- Issues requiring physical access to the server
- Social engineering attacks

## Security Best Practices

When running OpsBlaze:

- The server binds to `127.0.0.1` (localhost only) by default — only change `HOST` to `0.0.0.0` if you need LAN access from other devices
- Keep Node.js and dependencies up to date
- Restrict access to the `.env` file (contains credentials)
