# agent-memory-sdk

TypeScript SDK for building AI agents with automatic, scoped, persistent memory.

Full project documentation: [github.com/gharibyan/agent-memory](https://github.com/gharibyan/agent-memory).

## Install

```sh
npm install agent-memory-sdk
```

```sh
pnpm add agent-memory-sdk
yarn add agent-memory-sdk
```

## Quick Start

```ts
import { createAgent, openai } from "agent-memory-sdk"

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

First-party helpers include `openai()`, `anthropic()`, `gemini()`, and `xai()`. Use `openAICompatible()` for custom chat-completions endpoints.

If `userId` is omitted, memory is stored in the shared default scope. Local memory defaults to `.memory/memory.json`; use `sqliteMemory()` for `.memory/memory.sqlite` or `postgresMemory()` for Postgres with automatic pgvector migrations.

## Data Migration

Seed existing app data by passing normalized memories or events to the configured memory store:

```ts
await agent.memory.migrate({
  userId: "user_123",
  data: [
    {
      type: "preference",
      content: "User prefers concise weekly reports.",
      confidence: 0.9,
      importance: 0.8
    }
  ]
})
```

The SDK only validates and stores mapped input. Your app owns where the data comes from and how it is mapped. Use `events` and `sourceEventIds` when you want imported memories linked to imported history, and `mode: "skipExisting"` to leave matching memories unchanged.
