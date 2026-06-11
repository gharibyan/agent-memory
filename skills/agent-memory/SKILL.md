---
name: agent-memory-sdk
description: Use when building, integrating, testing, or extending the agent-memory TypeScript SDK
---

# Agent Memory SDK

## Overview

`agent-memory` is a TypeScript SDK that wraps model calls with automatic scoped memory, compact recall, and pluggable storage/model adapters.

## When to Use

Use this when:

- Adding `agent-memory` to an app, API route, worker, or service.
- Extending model providers or storage adapters.
- Testing memory recall, learning, forget/export, or package boundaries.
- Debugging prompt bloat or missing context in long-running chats.

## Package Boundaries

- `@agent-memory/core`: runtime-neutral engine, contracts, compiler, retrieval, in-memory store. No Node `fs`, provider SDKs, or database drivers.
- `@agent-memory/local`: local `.memory/memory.json` persistence.
- `@agent-memory/sqlite`: real SQLite `.memory/memory.sqlite` persistence.
- `@agent-memory/postgres`: Postgres persistence with automatic migrations and pgvector retrieval.
- `@agent-memory/openai`: OpenAI chat completions through the official `openai` SDK, including custom `baseURL` providers for compatible endpoints.
- `@agent-memory/anthropic`: Anthropic messages through the official `@anthropic-ai/sdk` package.
- `@agent-memory/gemini`: Gemini generation through the official `@google/genai` package.
- `@agent-memory/xai`: xAI chat completions through the documented OpenAI SDK-compatible client path with xAI defaults.
- `agent-memory`: public convenience package. `createAgent({ model })` should work with automatic local memory.

## Basic Usage

```ts
import { createAgent, openai } from "agent-memory"

const agent = createAgent({
  model: openai("gpt-5")
})

const result = await agent.generate({
  userId: "user_123",
  threadId: "thread_123",
  operationId: "op_migration",
  messages: [{ role: "user", content: "Remember that I prefer terse updates." }]
})
```

## Memory Rules

- Pass `userId` in multi-user apps. Missing `userId` writes to the default scope.
- Use `threadId` for chat-local context.
- Use `operationId` for complex multi-step work. Retrieval packs recent operation events without replaying the full chat.
- Set `memory: false` when memory must be disabled.
- Set per-call `memory: { learn: false }` for messages that should not teach durable memory.

## Extending

For a provider adapter, create a package like `@agent-memory/openai` and return a `ModelProvider`. Major first-party provider packages should depend on the provider's official SDK when one exists; OpenAI-compatible wrappers are for custom model endpoints and documented compatible providers.

For a storage adapter, create a package like `@agent-memory/local` and implement `MemoryStore`. Database adapters should own their migration lifecycle instead of making application code run setup manually.

Keep core dependency-free and runtime-neutral.

## Verification

Run:

```sh
pnpm test
pnpm lint
pnpm pack:check
```

Check package dry-runs for accidental inclusion of `apps/playground`, `.memory`, `.ai-memory`, tarballs, logs, screenshots, or local databases.
