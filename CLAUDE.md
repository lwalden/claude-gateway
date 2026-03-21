# CLAUDE.md - Project Instructions

> Claude reads this file automatically at the start of every session.
> Keep it concise — every line costs context tokens.
> Use `claude --continue` to restore the previous session's full message history.

## Project Identity

**Project:** claude-gateway
**Description:** HTTP gateway to Claude — CLI-first (local terminal + subscription), Anthropic API fallback
**Type:** api
**Stack:** Node.js / Express

**Developer Profile:**

- Experienced developer, high technical proficiency
- Aggressive autonomy — proceed freely; confirm only on major architectural changes

## MVP Goals

- Validate `/ask` endpoint works end-to-end (CLI path and API fallback path)
- Test suite covering core paths: auth, CLI invocation, API fallback, error handling
- Configurables reviewed and adjusted (timeouts, model, max_tokens, buffer limits)
- Security hardened: input validation, no secret leakage, safe error responses

## Behavioral Rules

### Git Workflow

See `.claude/rules/git-workflow.md` — loaded natively by Claude Code each session.

### Autonomy Boundaries

**You CAN autonomously:** Create files, install packages, run builds/tests, create branches and PRs, scaffold code

**Ask the human first:** Merge PRs, sign up for services, provide API keys

### Verification-First Development

- Write tests appropriate to the project's quality tier (see strategy-roadmap.md)
- When Standard tier or above: write failing tests first, then implement

### Decision Recording

- Record significant architectural decisions in DECISIONS.md (library choices, API contracts, auth approach, data model changes, deploy decisions)
- Record known shortcuts and workarounds in the Known Debt section of DECISIONS.md
- Include alternatives considered — a decision without alternatives is an assertion, not a record
- To auto-load DECISIONS.md every session, add `@DECISIONS.md` to this file

## Context Budget

> Use `/context` for real-time context usage and optimization tips.

**Always loaded:** CLAUDE.md — keep under ~50 lines; don't add without removing something

**On-demand:** DECISIONS.md — add `@DECISIONS.md` here to auto-load; delete superseded entries

**Sprint tracking:** SPRINT.md — auto-loaded via @import; archived when sprint completes

@SPRINT.md
