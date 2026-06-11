# @agent-memory/sdk

TypeScript SDK for building AI agents with automatic, scoped, persistent memory.

`@agent-memory/sdk` wraps model calls with memory recall and learning so apps can keep useful user, thread, and operation context without manually stuffing long chat histories into every prompt.

## Install

```sh
pnpm add @agent-memory/sdk
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
import { createAgent, openai } from "@agent-memory/sdk"

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

The public `@agent-memory/sdk` package defaults to local JSON persistence:

```ts
import { createAgent, openai } from "@agent-memory/sdk"

const agent = createAgent({
  model: openai("gpt-5")
})
```

By default this writes to `.memory/memory.json`.

For a real SQLite database:

```ts
import { createAgent, openai, sqliteMemory } from "@agent-memory/sdk"

const agent = createAgent({
  model: openai("gpt-5"),
  memory: sqliteMemory({
    path: ".memory/memory.sqlite"
  })
})
```

For Postgres with pgvector:

```ts
import { createAgent, openai, postgresMemory } from "@agent-memory/sdk"

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

First-party provider integrations are exported from `@agent-memory/sdk` and use provider SDKs or documented provider client paths internally. The OpenAI adapter depends on the official `openai` TypeScript SDK:

```ts
import { openai } from "@agent-memory/sdk"

const model = openai("gpt-5")
```

Anthropic and Gemini are exported by `@agent-memory/sdk` and use their official SDKs internally:

```ts
import { anthropic, gemini } from "@agent-memory/sdk"

const anthropicModel = anthropic("anthropic-model")
const geminiModel = gemini("gemini-2.5-pro")
```

xAI is exported by `@agent-memory/sdk` too. It uses the documented OpenAI SDK-compatible client path with xAI defaults:

```ts
import { xai } from "@agent-memory/sdk"

const model = xai("grok-4")
```

Use the OpenAI-compatible helper only for custom providers that expose a compatible chat completions API:

```ts
import { openAICompatible } from "@agent-memory/sdk"

const model = openAICompatible({
  model: "deepseek-chat",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY
})
```

## Package

`@agent-memory/sdk` is the only public npm package. It bundles the runtime, storage adapters, and model provider adapters behind one install and one import surface.

The repository still keeps implementation boundaries under `packages/*`:

- `packages/core`: runtime-neutral engine, contracts, compiler, retrieval, and in-memory store.
- `packages/local`: local JSON persistence adapter.
- `packages/sqlite`: real SQLite persistence adapter.
- `packages/postgres`: Postgres persistence adapter with pgvector migrations.
- `packages/openai`: OpenAI official SDK adapter, plus OpenAI-compatible custom endpoint support.
- `packages/anthropic`: Anthropic official SDK adapter.
- `packages/gemini`: Gemini official SDK adapter.
- `packages/xai`: xAI adapter using the documented OpenAI SDK-compatible client path.

Those workspace packages are private build units. They are compiled into `packages/agent-memory/dist/internal/*` during the public package build and are not published separately.

## Examples

```sh
pnpm --filter @agent-memory/playground dev
```

The local playground uses an echo model and local JSON memory.

For a real OpenAI call with SQLite memory:

```sh
cp apps/openai-sqlite-demo/.env.example apps/openai-sqlite-demo/.env
pnpm --filter @agent-memory/openai-sqlite-demo dev
```

Set `OPENAI_API_KEY` in `apps/openai-sqlite-demo/.env` or in your server environment. The key stays server-side, and memory persists to `.memory/openai-demo.sqlite` by default.

Both example apps are private to the repository and are not included in npm packages.

## Development

```sh
pnpm build
pnpm test
pnpm lint
pnpm pack:check
```

Package dry-runs must only publish the `@agent-memory/sdk` artifact and must not include `apps/playground`, `.memory`, local databases, logs, screenshots, or generated tarballs.

## License

MIT License. See [LICENSE](./LICENSE).
