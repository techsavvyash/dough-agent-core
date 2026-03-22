# Dough — AI Agent Platform

## Project overview

Dough is a client-server AI agent platform. The TUI and SDK are clients that connect to a server over WebSocket; the server handles LLM inference. Dual-provider from day one: Claude (via `@anthropic-ai/claude-agent-sdk`) and Codex (via `@openai/codex-sdk`).

**Runtime: Bun exclusively.** Never use Node.js, npm, pnpm, yarn, vite, express, or ws.

## Commands

```sh
bun install                          # install all workspace deps
bun run dev                          # start server + TUI in tmux (single command)
bun run server                       # server only (port 4200)
bun run tui                          # TUI only (connects to ws://localhost:4200/ws)
bun test                             # run all tests
bunx tsc --noEmit                    # typecheck
```

## Monorepo structure

Bun workspaces. 6 packages under `packages/`:

```
packages/
├── protocol/    @dough/protocol  — zero-dep wire types (events, messages, session)
├── threads/     @dough/threads   — generic pluggable thread manager (provider-agnostic)
├── core/        @dough/core      — LLM providers + agent loop
├── server/      @dough/server    — Bun.serve() + WebSocket on port 4200
├── tui/         @dough/tui       — OpenTUI React client
└── sdk/         @dough/sdk       — headless programmatic API
```

**Dependency DAG** (TUI and SDK never import core — only speak wire protocol):

```
@dough/protocol  →  @dough/threads  →  @dough/core  →  @dough/server
                                                         ↑ (WebSocket)
                                           @dough/tui ───┘
                                           @dough/sdk ───┘
```

## Code style

- TypeScript strict, no `any` unless unavoidable
- Prefer `interface` over `type` for object shapes
- Use Bun APIs: `Bun.serve()`, `bun:sqlite`, `Bun.file`, `Bun.$`
- TUI uses OpenTUI (`@opentui/react`) with lowercase JSX intrinsics: `<box>`, `<text>`, `<input>`, `<scrollbox>`
- TUI requires `"jsxImportSource": "@opentui/react"` in tsconfig

## Boundaries

### Always do
- Use Bun for everything (runtime, test, build, install)
- Run `bunx tsc --noEmit` before considering work complete
- Keep `@dough/protocol` and `@dough/threads` zero-LLM-dep (no claude-agent-sdk or codex-sdk imports)
- Wire types go in `@dough/protocol`, never in other packages

### Ask first
- Adding new workspace packages
- Changing the WebSocket protocol (ClientMessage/ServerMessage types)
- Modifying thread handoff/fork logic

### Never do
- Import `@dough/core` from TUI or SDK (they only use protocol types + WebSocket)
- Use express, ws, vite, webpack, jest, vitest, dotenv, or node:fs (use Bun equivalents)
- Commit .env files or API keys
- Delete migration files or JSONL session files
