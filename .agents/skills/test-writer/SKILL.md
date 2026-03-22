---
name: test-writer
description: Generate comprehensive unit and integration tests for TypeScript/JavaScript code using Bun's test runner.
---

# Test Writer Skill

When asked to write tests, follow these guidelines:

## Framework

- Use `bun:test` — `import { test, expect, describe, beforeEach } from "bun:test"`
- Co-locate tests: `foo.ts` → `foo.test.ts`

## Structure

1. **Describe blocks** — Group by function/class
2. **Happy path first** — Test the expected behavior
3. **Edge cases** — Empty inputs, boundaries, null/undefined
4. **Error cases** — Invalid inputs, thrown errors

## Patterns

- Use `beforeEach` for shared setup
- Prefer direct assertions over snapshot tests
- Mock external dependencies, not internal logic
- Test behavior, not implementation details
