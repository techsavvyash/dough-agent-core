---
name: code-review
description: Review code changes for bugs, style issues, and security vulnerabilities. Provides structured feedback with severity levels.
---

# Code Review Skill

When asked to review code, follow this structured approach:

## Process

1. **Read the changes** — Use diff view or read the modified files
2. **Categorize findings** by severity:
   - 🔴 **Critical** — Security vulnerabilities, data loss risks, crashes
   - 🟡 **Warning** — Bugs, logic errors, performance issues
   - 🔵 **Info** — Style, naming, minor improvements
3. **Provide actionable feedback** — Include specific line references and suggested fixes

## Output Format

```
## Code Review Summary

### Critical Issues
- [file:line] Description of issue + fix

### Warnings
- [file:line] Description + suggestion

### Suggestions
- [file:line] Minor improvement idea
```

## Rules

- Always check for OWASP top 10 vulnerabilities
- Flag any hardcoded secrets or credentials
- Check error handling completeness
- Verify input validation at system boundaries
