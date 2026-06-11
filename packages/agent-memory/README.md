# agent-memory

TypeScript SDK for building AI agents with automatic, scoped, persistent memory.

Full project documentation: [github.com/gharibyan/agent-memory](https://github.com/gharibyan/agent-memory).

```ts
import { createAgent, openAICompatible } from "agent-memory"

const agent = createAgent({
  model: openAICompatible({
    model: "deepseek-chat",
    baseURL: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY
  })
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

If `userId` is omitted, memory is stored in the shared default scope. Local memory defaults to `.memory/memory.json`; use `sqliteMemory()` for `.memory/memory.sqlite`.
