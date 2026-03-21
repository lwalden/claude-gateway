# PROGRESS.md - Current Project State

> Snapshot of where the project stands. Updated during sprint execution.

## Phase: Active Development (Early)

## Current State

| Area | Status | Notes |
|------|--------|-------|
| Express server (`src/index.js`) | Built, untested | Health check + `/ask` endpoint with bearer auth |
| Claude invocation (`src/claude.js`) | Built, untested | CLI-first via PowerShell, Anthropic API fallback |
| Auth | Built, untested | Shared-secret bearer token |
| Tests | None | No test framework installed yet |
| CI/CD | None | |

## Active Tasks

- Validate that the existing endpoints work end-to-end (CLI path + API fallback path)
- Add test framework and write initial tests
- Review configurables (timeouts, model defaults, max_tokens, etc.)
- Security audit (input validation, header handling, secret exposure)

## Next Priorities

1. Test the existing code -- confirm CLI and API paths work
2. Add testing infrastructure and cover core paths
3. Review and adjust configurables
4. Security hardening pass
