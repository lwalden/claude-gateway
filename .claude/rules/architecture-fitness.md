---
description: Architecture fitness rules — structural constraints for this project
---

# Architecture Fitness Rules

# AIAgentMinder-managed. Customize the rules below to match your project's architecture.

# Delete this file to opt out of architecture fitness enforcement.

## How to Use This File

These rules are enforced by Claude during code review, PR creation, and when writing new code.
Replace the examples below with constraints that match YOUR project's architecture.
Each rule should be specific enough that Claude can check it mechanically.

Rules that apply only to certain file types can be scoped with glob patterns in the frontmatter:

```yaml
globs: ["src/routes/**", "src/handlers/**"]
```

---

## Structural Constraints

<!-- Replace these examples with your own. Remove sections that don't apply. -->

### Layer Boundaries

### External API Calls

### Test Isolation

### File Size Limits

If a source file exceeds 300 lines, flag it for decomposition before adding more code.

---

## Enforcement

When writing or reviewing code:

1. Check each constraint above before creating or modifying a file in scope.
2. If a constraint would be violated: explain the rule, show the compliant alternative, and implement the compliant version.
3. If there's a legitimate exception: document it in a code comment (`// Architecture exception: [reason]`) and note it in DECISIONS.md.
