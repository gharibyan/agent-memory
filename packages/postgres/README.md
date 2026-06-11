# @agent-memory/postgres

Postgres persistence adapter for `agent-memory` with automatic migrations and pgvector retrieval.

```ts
import { createAgent } from "agent-memory"
import { postgresMemory } from "@agent-memory/postgres"

const agent = createAgent({
  model,
  memory: {
    store: postgresMemory({
      connectionString: process.env.DATABASE_URL,
      vectorDimensions: 1536
    })
  }
})
```

Migrations run automatically before the first memory operation. By default the adapter creates the `vector` extension, memory tables, version tracking table, relational indexes, and an HNSW cosine index for embeddings.

If your database provider manages extensions separately, install pgvector in the database and pass `createExtension: false`.

```ts
postgresMemory({
  connectionString: process.env.DATABASE_URL,
  createExtension: false,
  vectorDimensions: 1536
})
```

Use `autoMigrate: false` only when your own deployment pipeline runs equivalent migrations before the app starts.
