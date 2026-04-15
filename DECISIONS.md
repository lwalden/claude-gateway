# DECISIONS.md - Architectural Decision Log

> Record significant decisions to prevent re-debating them later.
> Not auto-loaded. Claude writes here when making architectural choices.
> To load automatically every session, add `@DECISIONS.md` to CLAUDE.md.
>

> **When to log:** choosing a library/framework, designing an API, selecting an auth approach, changing a data model, making a build/deploy decision.

---

## ADR Format

Format: Lightweight

**Lightweight:**
```
### [Title] | Date | Status: Active
Chose: [X] over [alternatives considered]. Why: [rationale]. Tradeoff: [what you gave up].
```

**Formal:**
```
### [Title]
- **Date:** [date]
- **Status:** Active | Superseded | Revisit
- **Context:** [what prompted this decision]
- **Options considered:** [option A, option B, option C]
- **Decision:** [what was chosen]
- **Tradeoffs:** [what was given up or accepted as risk]
- **Consequences:** [what this means going forward]
```

**Status values:** Active | Superseded | Revisit

---

### Express as HTTP framework | 2026-03-20 | Status: Active
Chose: Express over Fastify, Hono, or Koa. Why: widely known, minimal surface area for a thin gateway, no need for Fastify's performance or Hono's edge runtime support. Tradeoff: slightly less performant than Fastify, but irrelevant at this scale.

### CLI-first with API fallback | 2026-03-20 | Status: Active
Chose: invoke Claude CLI (`claude -p`) as primary path, Anthropic HTTP API as fallback. Why: CLI uses the existing Claude subscription (no per-token cost), API is pay-per-use safety net. Tradeoff: CLI invocation is slower and less controllable than direct API; depends on Claude CLI being installed and authenticated.

### PowerShell encoded commands for CLI invocation | 2026-03-20 | Status: Active
Chose: PowerShell `-EncodedCommand` (Base64 UTF-16LE) over `cmd.exe /c` or direct `execFile('claude', ...)`. Why: Windows `cmd.exe` mangles quotes in multi-word prompts; `claude` resolves to `claude.cmd` which requires a shell. Encoded commands bypass all quoting issues. Tradeoff: Windows-only approach; would need a Unix path for cross-platform support.

### Shared-secret bearer token auth | 2026-03-20 | Status: Active
Chose: single `GATEWAY_API_KEY` checked via `Authorization: Bearer` header over OAuth, JWT, or no auth. Why: simplest viable auth for a local/personal gateway. Tradeoff: no user identity, no token rotation, no revocation -- fine for single-user local use, insufficient for multi-user or public deployment.

### Vanilla JavaScript (no TypeScript) | 2026-03-20 | Status: Active
Chose: plain Node.js JavaScript over TypeScript. Why: minimal codebase (~160 lines total), fast iteration, no build step needed. Tradeoff: no compile-time type safety; acceptable given the small surface area.

### Stateless / no database | 2026-03-20 | Status: Active
Chose: no database, no conversation persistence. Why: gateway is a thin proxy -- each request is independent. Tradeoff: no multi-turn conversation support without the caller managing history.

### max_tokens: caller-configurable vs. fixed | 2026-04-12 | Status: Revisit
Deferred until a caller actually needs a different limit. Current behavior: fixed server-side default. Why defer: no real caller is blocked; YAGNI. Revisit when: a gateway consumer reports hitting the cap or needing a smaller cap for cost control.

### Cross-platform (Unix) CLI support | 2026-04-12 | Status: Revisit
Deferred. Current implementation is Windows-only due to the PowerShell `-EncodedCommand` choice. Why defer: no Unix runtime currently depends on the gateway. Revisit when: any consumer needs to run the gateway on Linux/macOS (e.g., cloud deployment, developer on a non-Windows machine).

---

## Known Debt

> Record shortcuts, workarounds, and deferred quality work here. Claude logs debt when implementing workarounds. `/aam-milestone` surfaces the debt list alongside scope drift.

| ID | Description | Impact | Logged | Sprint |
|---|---|---|---|---|
<!-- Debt entries go here -->
