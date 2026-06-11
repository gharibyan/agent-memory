# @agent-memory/sqlite

SQLite persistent memory adapter for `agent-memory`.

```ts
import { createAgent, openai } from "agent-memory"
import { sqliteMemory } from "@agent-memory/sqlite"

const agent = createAgent({
  model: openai("gpt-5"),
  memory: sqliteMemory()
})
```

By default, `sqliteMemory()` persists to `.memory/memory.sqlite`.

This adapter uses SQLite through `sql.js`, which keeps the first SQLite implementation portable across Node environments without native compilation.
