# Contributing to OpsBlaze

Thank you for your interest in contributing to OpsBlaze.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

1. Fork the repository and clone your fork
2. Run `node bin/setup.cjs` to configure your environment
3. Run `node bin/opsblaze.cjs check` to validate prerequisites
4. Run `node bin/opsblaze.cjs dev` to start the development server (Vite + tsx watch)
5. The frontend is available at `http://localhost:5173`, backend at `http://localhost:3000`

## Development Workflow

- **Typecheck**: `npm run typecheck`
- **Tests**: `npm test`
- **Lint**: `npm run lint` (Prettier)
- **Format**: `npm run lint:fix`

All checks must pass before submitting a pull request.

## Dependencies

- Use `npm ci` for routine installs. Reserve `npm install` for deliberate dependency changes, and review the resulting `package-lock.json` diff.
- Dependency updates flow through Dependabot, which enforces a cooldown: new versions must be at least 7 days old (14 for semver-majors) before an update PR is opened. Please don't submit PRs that bump dependencies to versions published within the last few days.
- Never run blanket `npm audit fix --force`; fix advisories with targeted upgrades.

## Pull Requests

1. Open an issue first to discuss the change
2. Create a feature branch from `main`
3. Keep changes focused — one feature or fix per PR
4. Include tests for new functionality where applicable
5. Update documentation if behavior changes

## Code Style

- TypeScript strict mode is enforced
- Use `pino` logger (not `console.log`) in server code
- Prefer explicit error handling over silent catches
- Follow existing patterns for new API routes and components

## Project Structure

See `AGENT_BOOTSTRAP.md` for a complete guide to the codebase.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
