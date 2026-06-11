# Agent Instructions

## Project Shape

This repo is a TypeScript-first pnpm workspace for the `agent-memory` SDK.

- `packages/core` is the private runtime-neutral workspace package. Do not add Node `fs`, provider SDKs, or database drivers here.
- `packages/local` is the private workspace package for local `.memory/memory.json` persistence.
- `packages/sqlite` is the private workspace package for real SQLite `.memory/memory.sqlite` persistence.
- `packages/postgres` is the private workspace package for Postgres persistence, automatic migrations, and pgvector search.
- `packages/openai` is the private workspace package for OpenAI model calls through the official `openai` SDK, plus compatible custom endpoint support.
- `packages/anthropic` is the private workspace package for Anthropic model calls through the official `@anthropic-ai/sdk` package.
- `packages/gemini` is the private workspace package for Gemini model calls through the official `@google/genai` package.
- `packages/xai` is the private workspace package for xAI model calls through the documented OpenAI SDK-compatible client path with xAI defaults.
- `packages/agent-memory` (`@agent-memory/sdk`) is the only public npm package. It should keep `createAgent({ model })` easy and automatic and bundle private workspace package output into `dist/internal`.
- `apps/playground` is private and must never ship in npm packages.

## Development Rules

- Keep source in TypeScript under `src`; generated output belongs in `dist`.
- Add tests before changing SDK behavior.
- Keep package build scripts cleaning `dist` before `tsc` so stale artifacts do not publish.
- Default memory should be automatic in `@agent-memory/sdk`, but core internals should stay adapter-neutral.
- Major first-party model provider adapters should use official provider SDKs. Compatibility wrappers are for custom OpenAI-compatible endpoints.
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

Package dry-runs must only target `@agent-memory/sdk` and must not include `apps/playground`, `.memory`, `.ai-memory`, generated tarballs, screenshots, logs, or local databases.
