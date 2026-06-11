import type {
  EventQuery,
  MemoryEmbedding,
  MemoryEvent,
  MemoryExport,
  MemoryListQuery,
  MemoryRecord,
  MemorySearchQuery,
  MemorySource,
  MemoryStore,
  VectorQuery,
  VectorResult
} from "@agent-memory/core"

export type PgQueryResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  rows: T[]
}

export type PgPoolLike = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<PgQueryResult<T>>
  end?: () => Promise<void>
}

export type PostgresMemoryOptions = {
  connectionString?: string
  pool?: PgPoolLike
  poolOptions?: Record<string, unknown>
  schema?: string
  vectorDimensions?: number
  autoMigrate?: boolean
  createExtension?: boolean
  createSchema?: boolean
}

export type PostgresMemoryStore = MemoryStore & {
  ready(): Promise<void>
  close(): Promise<void>
}

type TableNames = {
  migrations: string
  events: string
  records: string
  sources: string
  embeddings: string
}

type Filter = {
  sql: string
}

const DEFAULT_SCHEMA = "public"
const DEFAULT_VECTOR_DIMENSIONS = 32
const PGVECTOR_MAX_VECTOR_DIMENSIONS = 2000
const BASE_MIGRATION_ID = "2026_06_11_001_base_pgvector_memory"

export function postgresMemory(options: PostgresMemoryOptions = {}): PostgresMemoryStore {
  const schema = options.schema ?? DEFAULT_SCHEMA
  const vectorDimensions = validateVectorDimensions(options.vectorDimensions ?? DEFAULT_VECTOR_DIMENSIONS)
  const autoMigrate = options.autoMigrate !== false
  const createExtension = options.createExtension !== false
  const createSchema = options.createSchema !== false
  const tables = tableNames(schema)
  let poolPromise: Promise<PgPoolLike> | undefined
  let readyPromise: Promise<void> | undefined
  let ownsPool = false

  async function pool(): Promise<PgPoolLike> {
    if (options.pool) return options.pool

    poolPromise ??= createPool(options).then((createdPool) => {
      ownsPool = true
      return createdPool
    })
    return poolPromise
  }

  async function ready(): Promise<void> {
    const pg = await pool()
    if (!autoMigrate) return

    readyPromise ??= runMigrations(pg, {
      createExtension,
      createSchema,
      schema,
      tables,
      vectorDimensions
    })
    await readyPromise
  }

  async function query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<PgQueryResult<T>> {
    await ready()
    return (await pool()).query<T>(text, values)
  }

  const store: PostgresMemoryStore = {
    kind: "postgres",
    ready,

    async close(): Promise<void> {
      const pg = options.pool ?? await poolPromise
      if (ownsPool && pg?.end) await pg.end()
    },

    async writeEvent(event: MemoryEvent): Promise<void> {
      await query(`
        INSERT INTO ${tables.events} (
          id, scope_key, thread_id, operation_id, role, content, metadata_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (id) DO UPDATE SET
          scope_key = EXCLUDED.scope_key,
          thread_id = EXCLUDED.thread_id,
          operation_id = EXCLUDED.operation_id,
          role = EXCLUDED.role,
          content = EXCLUDED.content,
          metadata_json = EXCLUDED.metadata_json,
          created_at = EXCLUDED.created_at
      `, [
        event.id,
        event.scopeKey,
        event.threadId ?? null,
        event.operationId ?? null,
        event.role,
        event.content,
        JSON.stringify(event.metadata ?? {}),
        event.createdAt
      ])
    },

    async listRecentEvents(input: EventQuery = {}): Promise<MemoryEvent[]> {
      const values: unknown[] = []
      const filters = buildFilters([
        inFilter("scope_key", input.scopeKeys, values),
        input.threadId === undefined ? null : equalsFilter("thread_id", input.threadId, values),
        input.operationId === undefined ? null : equalsFilter("operation_id", input.operationId, values),
        inFilter("id", input.excludeEventIds, values, true)
      ])
      const limit = addParam(values, input.limit ?? 20)

      const result = await query(`
        SELECT id, scope_key, thread_id, operation_id, role, content, metadata_json, created_at
        FROM ${tables.events}
        ${filters}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `, values)

      return result.rows.map(eventFromRow)
    },

    async upsertMemory(record: MemoryRecord): Promise<MemoryRecord> {
      const existing = await findExistingMemory(query, tables, record)
      const memory = existing ? { ...record, id: existing.id, createdAt: existing.createdAt } : record
      const updatedAt = existing ? new Date().toISOString() : memory.updatedAt

      await query(`
        INSERT INTO ${tables.records} (
          id, scope_key, type, content, canonical_key, confidence, importance,
          sensitivity, status, source_event_ids_json, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          scope_key = EXCLUDED.scope_key,
          type = EXCLUDED.type,
          content = EXCLUDED.content,
          canonical_key = EXCLUDED.canonical_key,
          confidence = EXCLUDED.confidence,
          importance = EXCLUDED.importance,
          sensitivity = EXCLUDED.sensitivity,
          status = EXCLUDED.status,
          source_event_ids_json = EXCLUDED.source_event_ids_json,
          updated_at = EXCLUDED.updated_at
      `, [
        memory.id,
        memory.scopeKey,
        memory.type,
        memory.content,
        memory.canonicalKey ?? null,
        memory.confidence,
        memory.importance,
        memory.sensitivity,
        memory.status,
        JSON.stringify(memory.sourceEventIds ?? []),
        memory.createdAt,
        updatedAt
      ])

      return {
        ...memory,
        updatedAt
      }
    },

    async listMemories(input: MemoryListQuery = {}): Promise<MemoryRecord[]> {
      const values: unknown[] = []
      const filters = buildFilters([
        equalsFilter("status", "active", values),
        inFilter("scope_key", input.scopeKeys, values)
      ])
      const limit = addParam(values, input.limit ?? 100)

      const result = await query(`
        SELECT *
        FROM ${tables.records}
        ${filters}
        ORDER BY importance DESC, updated_at DESC
        LIMIT ${limit}
      `, values)

      return result.rows.map(memoryFromRow)
    },

    async searchMemories(input: MemorySearchQuery = {}): Promise<MemoryRecord[]> {
      if (!input.query?.trim()) return store.listMemories(input)

      const values: unknown[] = []
      const searchFilters = tokenizeSearch(input.query).map((term) => {
        const value = `%${term}%`
        return [
          `LOWER(content) LIKE LOWER(${addParam(values, value)})`,
          `LOWER(type) LIKE LOWER(${addParam(values, value)})`,
          `LOWER(COALESCE(canonical_key, '')) LIKE LOWER(${addParam(values, value)})`
        ].join(" OR ")
      }).map((sql) => ({ sql: `(${sql})` }))
      const filters = buildFilters([
        equalsFilter("status", "active", values),
        inFilter("scope_key", input.scopeKeys, values),
        ...searchFilters
      ])
      const limit = addParam(values, input.limit ?? 100)

      const result = await query(`
        SELECT *
        FROM ${tables.records}
        ${filters}
        ORDER BY importance DESC, updated_at DESC
        LIMIT ${limit}
      `, values)

      return result.rows.map(memoryFromRow)
    },

    async linkSource(source: MemorySource): Promise<void> {
      await query(`
        INSERT INTO ${tables.sources} (memory_id, event_id, quote, reason)
        VALUES ($1, $2, $3, $4)
      `, [
        source.memoryId,
        source.eventId,
        source.quote ?? null,
        source.reason
      ])
    },

    async upsertEmbedding(embedding: MemoryEmbedding): Promise<void> {
      validateEmbeddingDimensions(embedding, vectorDimensions)

      await query(`
        INSERT INTO ${tables.embeddings} (
          owner_type, owner_id, model, dimensions, vector_json, "embedding", created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector, $7)
        ON CONFLICT (owner_type, owner_id) DO UPDATE SET
          model = EXCLUDED.model,
          dimensions = EXCLUDED.dimensions,
          vector_json = EXCLUDED.vector_json,
          "embedding" = EXCLUDED."embedding",
          created_at = EXCLUDED.created_at
      `, [
        embedding.ownerType,
        embedding.ownerId,
        embedding.model,
        embedding.dimensions,
        JSON.stringify(embedding.vector),
        vectorLiteral(embedding.vector),
        embedding.createdAt
      ])
    },

    async searchEmbeddings(input: VectorQuery): Promise<VectorResult[]> {
      validateVector("query vector", input.vector)
      if (input.vector.length !== vectorDimensions) {
        throw new Error(
          `postgresMemory vectorDimensions is ${vectorDimensions}, but received a ${input.vector.length}-dimension query vector.`
        )
      }

      const values: unknown[] = [vectorLiteral(input.vector)]
      const filters = buildFilters([
        equalsFilter("m.status", "active", values),
        equalsFilter("e.owner_type", "memory", values),
        inFilter("m.scope_key", input.scopeKeys, values)
      ])
      const limit = addParam(values, input.limit ?? 20)

      const result = await query(`
        SELECT
          e.owner_type,
          e.owner_id,
          1 - (e."embedding" <=> $1::vector) AS score
        FROM ${tables.embeddings} e
        JOIN ${tables.records} m ON m.id = e.owner_id
        ${filters}
        ORDER BY e."embedding" <=> $1::vector
        LIMIT ${limit}
      `, values)

      return result.rows.map((row) => ({
        ownerType: String(row.owner_type),
        ownerId: String(row.owner_id),
        score: Number(row.score)
      }))
    },

    async deleteMemory(memoryId: string): Promise<void> {
      await query(`UPDATE ${tables.records} SET status = $1, updated_at = $2 WHERE id = $3`, [
        "deleted",
        new Date().toISOString(),
        memoryId
      ])
    },

    async forget(input: MemoryListQuery = {}): Promise<void> {
      const values: unknown[] = []
      const filters = buildFilters([inFilter("scope_key", input.scopeKeys, values)])
      const where = filters || "WHERE 1 = 1"

      await query(`
        DELETE FROM ${tables.sources}
        WHERE memory_id IN (SELECT id FROM ${tables.records} ${where})
      `, values)
      await query(`
        DELETE FROM ${tables.embeddings}
        WHERE owner_id IN (SELECT id FROM ${tables.records} ${where})
      `, values)
      await query(`DELETE FROM ${tables.records} ${where}`, values)
      await query(`DELETE FROM ${tables.events} ${where}`, values)
    },

    async export(input: MemoryListQuery & { eventLimit?: number } = {}): Promise<MemoryExport> {
      const memories = await store.listMemories(input)
      const events = await store.listRecentEvents({ ...input, limit: input.eventLimit ?? 1000 })
      return { memories, events }
    }
  }

  return store
}

async function createPool(options: PostgresMemoryOptions): Promise<PgPoolLike> {
  if (!options.connectionString && !options.poolOptions) {
    throw new Error("postgresMemory requires either a connectionString, poolOptions, or a pg-compatible pool.")
  }

  const { Pool } = await import("pg")
  return new Pool({
    ...options.poolOptions,
    connectionString: options.connectionString
  })
}

async function runMigrations(pool: PgPoolLike, input: {
  createExtension: boolean
  createSchema: boolean
  schema: string
  tables: TableNames
  vectorDimensions: number
}): Promise<void> {
  if (input.createExtension) {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector
    `)
  }

  if (input.createSchema && input.schema !== DEFAULT_SCHEMA) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(input.schema)}`)
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${input.tables.migrations} (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const migrations = [{
    id: BASE_MIGRATION_ID,
    statements: baseMigrationStatements(input.tables, input.vectorDimensions)
  }]

  for (const migration of migrations) {
    const existing = await pool.query(`SELECT id FROM ${input.tables.migrations} WHERE id = $1 LIMIT 1`, [migration.id])
    if (existing.rows.length > 0) continue

    await pool.query("BEGIN")
    try {
      for (const statement of migration.statements) {
        await pool.query(statement)
      }
      await pool.query(`
        INSERT INTO ${input.tables.migrations} (id, applied_at)
        VALUES ($1, NOW())
        ON CONFLICT (id) DO NOTHING
      `, [migration.id])
      await pool.query("COMMIT")
    } catch (error) {
      await pool.query("ROLLBACK")
      throw error
    }
  }
}

function baseMigrationStatements(tables: TableNames, vectorDimensions: number): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS ${tables.events} (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        thread_id TEXT,
        operation_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS memory_events_scope_created_idx
        ON ${tables.events} (scope_key, created_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS memory_events_thread_operation_idx
        ON ${tables.events} (thread_id, operation_id)
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tables.records} (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        canonical_key TEXT,
        confidence DOUBLE PRECISION NOT NULL,
        importance DOUBLE PRECISION NOT NULL,
        sensitivity TEXT NOT NULL,
        status TEXT NOT NULL,
        source_event_ids_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS memory_records_scope_canonical_idx
        ON ${tables.records} (scope_key, canonical_key)
        WHERE canonical_key IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS memory_records_scope_status_idx
        ON ${tables.records} (scope_key, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS memory_records_content_idx
        ON ${tables.records} (content)
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tables.sources} (
        memory_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        quote TEXT,
        reason TEXT NOT NULL
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS memory_sources_memory_idx
        ON ${tables.sources} (memory_id)
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tables.embeddings} (
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_json JSONB NOT NULL,
        "embedding" vector(${vectorDimensions}) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (owner_type, owner_id)
      )
    `,
    `
      CREATE INDEX IF NOT EXISTS memory_embeddings_owner_idx
        ON ${tables.embeddings} (owner_type, owner_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS memory_embeddings_embedding_hnsw_idx
        ON ${tables.embeddings}
        USING hnsw ("embedding" vector_cosine_ops)
    `
  ]
}

async function findExistingMemory(
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ) => Promise<PgQueryResult<T>>,
  tables: TableNames,
  record: MemoryRecord
): Promise<{ id: string; createdAt: string } | null> {
  const result = record.canonicalKey
    ? await query(`
        SELECT id, created_at
        FROM ${tables.records}
        WHERE id = $1 OR (scope_key = $2 AND canonical_key = $3)
        LIMIT 1
      `, [record.id, record.scopeKey, record.canonicalKey])
    : await query(`
        SELECT id, created_at
        FROM ${tables.records}
        WHERE id = $1
        LIMIT 1
      `, [record.id])

  const first = result.rows[0]
  if (!first) return null

  return {
    id: String(first.id),
    createdAt: dateString(first.created_at)
  }
}

function tableNames(schema: string): TableNames {
  const qualified = (table: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
  return {
    migrations: qualified("agent_memory_migrations"),
    events: qualified("memory_events"),
    records: qualified("memory_records"),
    sources: qualified("memory_sources"),
    embeddings: qualified("memory_embeddings")
  }
}

function buildFilters(filters: Array<Filter | null>): string {
  const active = filters.filter((filter): filter is Filter => Boolean(filter))
  if (active.length === 0) return ""
  return `WHERE ${active.map((filter) => filter.sql).join(" AND ")}`
}

function equalsFilter(column: string, value: unknown, values: unknown[]): Filter {
  return {
    sql: `${column} = ${addParam(values, value)}`
  }
}

function inFilter(column: string, entries: string[] | undefined, values: unknown[], negate = false): Filter | null {
  if (!entries || entries.length === 0) return null
  const placeholders = entries.map((entry) => addParam(values, entry)).join(", ")
  const operator = negate ? "NOT IN" : "IN"
  return {
    sql: `${column} ${operator} (${placeholders})`
  }
}

function addParam(values: unknown[], value: unknown): string {
  values.push(value)
  return `$${values.length}`
}

function eventFromRow(row: Record<string, unknown>): MemoryEvent {
  return {
    id: String(row.id),
    scopeKey: String(row.scope_key),
    threadId: nullableString(row.thread_id),
    operationId: nullableString(row.operation_id),
    role: row.role as MemoryEvent["role"],
    content: String(row.content),
    metadata: jsonObject(row.metadata_json),
    createdAt: dateString(row.created_at)
  }
}

function memoryFromRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    scopeKey: String(row.scope_key),
    type: String(row.type),
    content: String(row.content),
    canonicalKey: nullableString(row.canonical_key),
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    sensitivity: row.sensitivity as MemoryRecord["sensitivity"],
    status: row.status as MemoryRecord["status"],
    sourceEventIds: jsonArray(row.source_event_ids_json).map(String),
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at)
  }
}

function tokenizeSearch(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function validateVectorDimensions(dimensions: number): number {
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > PGVECTOR_MAX_VECTOR_DIMENSIONS) {
    throw new Error(
      `postgresMemory vectorDimensions must be an integer between 1 and ${PGVECTOR_MAX_VECTOR_DIMENSIONS}.`
    )
  }
  return dimensions
}

function validateEmbeddingDimensions(embedding: MemoryEmbedding, expectedDimensions: number): void {
  validateVector("embedding vector", embedding.vector)
  if (embedding.dimensions !== expectedDimensions || embedding.vector.length !== expectedDimensions) {
    const actual = embedding.dimensions || embedding.vector.length
    throw new Error(
      `postgresMemory vectorDimensions is ${expectedDimensions}, but received a ${actual}-dimension embedding.`
    )
  }
}

function validateVector(label: string, vector: number[]): void {
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`postgresMemory expected ${label} to be a non-empty finite number array.`)
  }
}

function vectorLiteral(vector: number[]): string {
  validateVector("vector", vector)
  return `[${vector.join(",")}]`
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string") return {}

  const parsed = JSON.parse(value) as unknown
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return []

  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed : []
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value)
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`
}
