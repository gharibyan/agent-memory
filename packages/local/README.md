# packages/local

Private local persistent memory implementation for `agent-memory-sdk`.

```ts
import { createAgent, localMemory } from "agent-memory-sdk"

const agent = createAgent({
  model,
  memory: localMemory()
})
```

By default, local memory persists to `.memory/memory.json` in the current working directory. This adapter is meant for local development, prototypes, and single-node apps. Use `sqliteMemory()` from `agent-memory-sdk` when you need a real SQLite database file.
