# Agent Instructions

## Project Shape

This repo is a TypeScript-first pnpm workspace for the `agent-memory` SDK.

- `packages/core` (`@agent-memory/core`) is runtime-neutral. Do not add Node `fs`, provider SDKs, or database drivers here.
- `packages/local` (`@agent-memory/local`) owns local `.memory/memory.json` persistence.
- `packages/sqlite` (`@agent-memory/sqlite`) owns real SQLite `.memory/memory.sqlite` persistence.
- `packages/postgres` (`@agent-memory/postgres`) owns Postgres persistence, automatic migrations, and pgvector search.
- `packages/openai` (`@agent-memory/openai`) owns OpenAI-compatible model calls.
- `packages/agent-memory` is the public convenience package. It should keep `createAgent({ model })` easy and automatic.
- `apps/playground` is private and must never ship in npm packages.

## Development Rules

- Keep source in TypeScript under `src`; generated output belongs in `dist`.
- Add tests before changing SDK behavior.
- Keep package build scripts cleaning `dist` before `tsc` so stale artifacts do not publish.
- Default memory should be automatic in `agent-memory`, but direct `@agent-memory/core` usage should stay adapter-neutral.
- Keep `sqliteMemory()` backed by a real SQLite database file, not JSON.
- Keep `postgresMemory()` responsible for running its own versioned migrations before the first database operation by default.
- Use `operationId` and `threadId` for active operation context instead of replaying long chats into prompts.

## Verification

Run these before handing work back:

```sh
pnpm test
pnpm lint
pnpm pack:check
```

Package dry-runs must not include `apps/playground`, `.memory`, `.ai-memory`, generated tarballs, screenshots, logs, or local databases.
