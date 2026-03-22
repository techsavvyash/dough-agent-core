# Dough — AI Agent Platform

## Quick Reference

```sh
bun install          # install deps (Bun workspaces)
bun test             # run all 136 tests
bun run dev          # start server + TUI in tmux
```

## Architecture

Bun monorepo with 6 packages. Client-server over WebSocket.

```
@dough/protocol   ← zero-dep wire types (events, messages, session types)
@dough/threads    ← provider-agnostic thread manager (200k token cap, handoff/fork)
@dough/core       ← LLM providers (Claude via claude-agent-sdk) + agent session loop
@dough/server     ← Bun.serve() + WebSocket, file change tracking
@dough/tui        ← OpenTUI React terminal client
@dough/sdk        ← headless programmatic API (stub)
```

**Dependency flow:** `protocol → threads → core → server`. TUI and SDK only speak the wire protocol — they never import core.

## Runtime

**Bun exclusively.** No Node.js, no npm/yarn/pnpm, no vite/webpack.

- `bun <file>` not `node <file>`
- `bun test` not jest/vitest
- `bun install` not npm install
- `Bun.serve()` not express
- `bun:sqlite` not better-sqlite3
- `Bun.file()` over `node:fs`
- Bun auto-loads `.env` — no dotenv

## Testing

```sh
bun test                    # all tests
bun test packages/tui/      # TUI component tests only
bun test packages/core/     # core/session tests only
```

**TUI tests** use OpenTUI's built-in test utilities:
- `testRender(node, { width, height })` from `@opentui/react/test-utils`
- `createSpy()` from `@opentui/core/testing`
- `mockInput.pressKey()`, `.pressEnter()`, `.pressArrow()`, `.typeText()`
- `captureCharFrame()` returns the rendered terminal output as a string

**Key testing quirks:**
- `pressEscape()` needs `await act(async () => { mockInput.pressEscape(); await new Promise(r => setTimeout(r, 150)); })` — the terminal parser holds bare `\x1B` waiting for escape sequence bytes
- State-updating key presses (enter/arrow that trigger `useState` setters) need `act(() => { mockInput.pressKey(...) })` wrapper
- Regular keys (`j`, `k`) and `pressEnter()` that only call callbacks (not state setters) work without `act()`

## TUI Framework

**OpenTUI** (`@opentui/react` v0.1.90) — Zig-native core with React reconciler.

- JSX intrinsics are **lowercase**: `<box>`, `<text>`, `<input>`, `<scrollbox>`
- `<input>` cursor positioning is absolute — cannot coexist in a flex row with sibling `<text>` for prefix display. Use the `placeholder` prop instead.
- Hooks: `useKeyboard(handler)`, `useTerminalDimensions()` from `@opentui/react`

## LLM Provider

Currently using `@anthropic-ai/claude-agent-sdk` (v0.2.81). Uses Claude Max subscription auth — no API key needed.

**SDK tool names are capitalized:** `Write`, `Edit`, `Read`, `MultiEdit`, `Bash`, `Glob`, `Grep` (not `write_file`, `edit_file` etc.)

**SDK message types:** `system`, `assistant`, `stream_event`, `user` (with tool_result blocks), `result`, `tool_progress`, `tool_use_summary`

## Key Patterns

**Event system:** All server→client communication flows through `DoughEvent` discriminated union (see `packages/protocol/src/events.ts`). Events: `content_delta`, `content_complete`, `thought`, `tool_call_request`, `tool_call_response`, `thread_handoff`, `thread_forked`, `context_window_warning`, `change_stats_update`, `finished`, `error`, `aborted`.

**Thread management:** `ThreadManager` in `@dough/threads` enforces 200k token cap. Warns at 90%, auto-handoff at limit. Threads have origin: `root | handoff | fork`.

**File diff tracking:** Server snapshots files before agent writes (copy-on-write), computes unified diffs on demand. TUI shows GitHub PR-style diff view via `Ctrl+D`.

**Dev workflow:** `bun run dev` starts server (port 4200) and TUI in tmux. Server in window 0, TUI in window 1.

## Ports

- `4200` — Dough server (HTTP + WebSocket at `/ws`)
