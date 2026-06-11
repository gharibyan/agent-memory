# @agent-memory/local

Local persistent memory adapter for `agent-memory`.

```ts
import { createAgent } from "@agent-memory/core"
import { localMemory } from "@agent-memory/local"

const agent = createAgent({
  model,
  memory: localMemory()
})
```

By default, local memory persists to `.memory/memory.json` in the current working directory. This adapter is meant for local development, prototypes, and single-node apps. Use `@agent-memory/sqlite` when you need a real SQLite database file.
