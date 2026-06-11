# agent-memory

TypeScript SDK for building AI agents with automatic, scoped, persistent memory.

`agent-memory` wraps model calls with memory recall and learning so apps can keep useful user, thread, and operation context without manually stuffing long chat histories into every prompt.

## Install

```sh
pnpm add agent-memory
```

For workspace development:

```sh
pnpm install
pnpm test
pnpm lint
pnpm pack:check
```

## Quick Start

```ts
import { createAgent, openai } from "agent-memory"

const agent = createAgent({
  model: openai("gpt-5")
})

const result = await agent.generate({
  userId: "user_123",
  threadId: "thread_123",
  operationId: "op_weekly_update",
  messages: [
    { role: "user", content: "Remember that I prefer concise weekly reports." }
  ]
})

console.log(result.text)
```

If `userId` is omitted, memory is stored in the shared default scope. That is useful for prototypes and single-user apps. In multi-user apps, pass `userId`.

## Memory Model

- `userId`: durable user memory isolation.
- `orgId`: organization-level recall.
- `threadId`: chat-local context.
- `operationId`: compact active-operation context for complex workflows.
- `memory.contextBudget`: limits injected memory context to avoid token bloat.
- `memory.learn: false`: disables learning for a single call.
- `memory.recall: false`: disables recall for a single call.

## Storage

The public `agent-memory` package defaults to local JSON persistence:

```ts
import { createAgent, openai } from "agent-memory"

const agent = createAgent({
  model: openai("gpt-5")
})
```

By default this writes to `.memory/memory.json`.

For a real SQLite database:

```ts
import { createAgent, openai, sqliteMemory } from "agent-memory"

const agent = createAgent({
  model: openai("gpt-5"),
  memory: sqliteMemory({
    path: ".memory/memory.sqlite"
  })
})
```

For Postgres with pgvector:

```ts
import { createAgent, openai, postgresMemory } from "agent-memory"

const agent = createAgent({
  model: openai("gpt-5"),
  memory: {
    store: postgresMemory({
      connectionString: process.env.DATABASE_URL,
      vectorDimensions: 1536
    })
  }
})
```

The Postgres adapter runs migrations automatically before the first memory operation. It creates the pgvector extension by default, version-tracks migrations, creates relational memory tables, and adds an HNSW cosine index for vector search. If your database provider manages extensions separately, install pgvector in the database and pass `createExtension: false`.

## Model Providers

First-party provider integrations should use provider SDKs or documented provider client paths. The OpenAI adapter depends on the official `openai` TypeScript SDK:

```ts
import { openai } from "agent-memory"

const model = openai("gpt-5")
```

Anthropic and Gemini live in their own adapter packages and are also re-exported by `agent-memory`:

```ts
import { anthropic, gemini } from "agent-memory"

const anthropicModel = anthropic("anthropic-model")
const geminiModel = gemini("gemini-2.5-pro")
```

xAI has a first-class package too. It uses the documented OpenAI SDK-compatible client path with xAI defaults:

```ts
import { xai } from "agent-memory"

const model = xai("grok-4")
```

Use the OpenAI-compatible helper only for custom providers that expose a compatible chat completions API:

```ts
import { openAICompatible } from "agent-memory"

const model = openAICompatible({
  model: "deepseek-chat",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY
})
```

## Packages

- `agent-memory`: public convenience package with automatic local memory defaults.
- `@agent-memory/core`: runtime-neutral engine, contracts, compiler, retrieval, and in-memory store.
- `@agent-memory/local`: local JSON persistence adapter.
- `@agent-memory/sqlite`: real SQLite persistence adapter.
- `@agent-memory/postgres`: Postgres persistence adapter with pgvector migrations.
- `@agent-memory/openai`: OpenAI official SDK adapter, plus OpenAI-compatible custom endpoint support.
- `@agent-memory/anthropic`: Anthropic official SDK adapter.
- `@agent-memory/gemini`: Gemini official SDK adapter.
- `@agent-memory/xai`: xAI adapter using the documented OpenAI SDK-compatible client path.

## Playground

```sh
pnpm --filter @agent-memory/playground dev
```

The playground is private to the repository and is not included in npm packages.

## Development

```sh
pnpm build
pnpm test
pnpm lint
pnpm pack:check
```

Package dry-runs must not include `apps/playground`, `.memory`, local databases, logs, screenshots, or generated tarballs.

## License

MIT License. See [LICENSE](./LICENSE).
