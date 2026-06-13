# Contributing to agent-memory-sdk

Thanks for taking the time to improve `agent-memory-sdk`. This project is a
TypeScript-first pnpm workspace that publishes one public npm package:
`agent-memory-sdk`.

## Project Boundaries

- `packages/agent-memory` is the public package and should keep
  `createAgent({ model })` easy to use.
- `packages/core` is runtime-neutral. Do not add Node `fs`, provider SDKs, or
  database drivers there.
- `packages/local`, `packages/sqlite`, and `packages/postgres` own persistence
  adapters.
- `packages/openai`, `packages/anthropic`, `packages/gemini`, and
  `packages/xai` own model provider adapters.
- `apps/*` are examples and demos. They are private and must never be included
  in npm package output.

## Development Setup

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm pack:check
```

Use Node.js and pnpm versions compatible with the `packageManager` field in
`package.json`.

## Before Opening a Pull Request

Please make sure the change is focused and includes tests when SDK behavior
changes.

Run:

```sh
pnpm test
pnpm lint
pnpm pack:check
```

`pnpm pack:check` should show only the public `agent-memory-sdk` artifact. It
must not include `apps/playground`, `.memory`, `.ai-memory`, generated tarballs,
screenshots, logs, or local databases.

## Pull Request Expectations

- Explain the problem and the approach.
- Include examples or docs updates when public API behavior changes.
- Keep source changes in TypeScript under `src`.
- Keep generated output in `dist` and do not hand-edit it.
- Keep build scripts cleaning `dist` before TypeScript compilation.

## Issues

Use the issue templates when possible. For security issues, do not open a public
issue; follow the instructions in `SECURITY.md`.
