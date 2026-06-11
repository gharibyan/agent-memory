# agent-memory-sdk

TypeScript SDK for building AI agents with automatic, scoped, persistent memory.

Full project documentation: [github.com/gharibyan/agent-memory](https://github.com/gharibyan/agent-memory).

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
