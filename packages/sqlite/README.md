# packages/sqlite

Private SQLite persistent memory implementation for `agent-memory-sdk`.

```ts
import { createAgent, openai, sqliteMemory } from "agent-memory-sdk"

const agent = createAgent({
  model: openai("gpt-5"),
  memory: sqliteMemory()
})
```

By default, `sqliteMemory()` persists to `.memory/memory.sqlite`.

This adapter uses SQLite through `sql.js`, which keeps the first SQLite implementation portable across Node environments without native compilation.
