import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import initSqlJs from "sql.js"
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
import type { Database } from "sql.js"

export type SqliteMemoryOptions = {
  path?: string
}

export function sqliteMemory(options: SqliteMemoryOptions = {}): MemoryStore {
  const path = resolve(options.path ?? ".memory/memory.sqlite")
  let databasePromise: Promise<Database> | undefined

  async function database(): Promise<Database> {
    databasePromise ??= openDatabase(path)
    return databasePromise
  }

  async function persist(db: Database): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(db.export()))
  }

  return {
    kind: "sqlite",

    async writeEvent(event: MemoryEvent): Promise<void> {
      const db = await database()
      db.run(`
        INSERT INTO memory_events (
          id, scope_key, thread_id, operation_id, role, content, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scope_key = excluded.scope_key,
          thread_id = excluded.thread_id,
          operation_id = excluded.operation_id,
          role = excluded.role,
          content = excluded.content,
          metadata_json = excluded.metadata_json,
          created_at = excluded.created_at
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
      await persist(db)
    },

    async listRecentEvents(query: EventQuery = {}): Promise<MemoryEvent[]> {
      const db = await database()
      const filters = buildFilters([
        inFilter("scope_key", query.scopeKeys),
        query.threadId === undefined ? null : { sql: "thread_id = ?", params: [query.threadId] },
        query.operationId === undefined ? null : { sql: "operation_id = ?", params: [query.operationId] },
        inFilter("id", query.excludeEventIds, true)
      ])

      return select(db, `
        SELECT id, scope_key, thread_id, operation_id, role, content, metadata_json, created_at
        FROM memory_events
        ${filters.where}
        ORDER BY created_at DESC
        LIMIT ?
      `, [...filters.params, query.limit ?? 20]).map(eventFromRow)
    },

    async upsertMemory(record: MemoryRecord): Promise<MemoryRecord> {
      const db = await database()
      const existing = findExistingMemory(db, record)
      const memory = existing ? { ...record, id: existing.id, createdAt: existing.createdAt } : record
      const updatedAt = existing ? new Date().toISOString() : memory.updatedAt

      db.run(`
        INSERT INTO memory_records (
          id, scope_key, type, content, canonical_key, confidence, importance,
          sensitivity, status, source_event_ids_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scope_key = excluded.scope_key,
          type = excluded.type,
          content = excluded.content,
          canonical_key = excluded.canonical_key,
          confidence = excluded.confidence,
          importance = excluded.importance,
          sensitivity = excluded.sensitivity,
          status = excluded.status,
          source_event_ids_json = excluded.source_event_ids_json,
          updated_at = excluded.updated_at
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
      await persist(db)

      return {
        ...memory,
        updatedAt
      }
    },

    async listMemories(query: MemoryListQuery = {}): Promise<MemoryRecord[]> {
      const db = await database()
      const filters = buildFilters([
        { sql: "status = ?", params: ["active"] },
        inFilter("scope_key", query.scopeKeys)
      ])

      return select(db, `
        SELECT *
        FROM memory_records
        ${filters.where}
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `, [...filters.params, query.limit ?? 100]).map(memoryFromRow)
    },

    async searchMemories(query: MemorySearchQuery = {}): Promise<MemoryRecord[]> {
      if (!query.query?.trim()) {
        return this.listMemories(query)
      }

      const db = await database()
      const terms = tokenizeSearch(query.query)
      const searchFilters = terms.map((term) => ({
        sql: "(LOWER(content) LIKE ? OR LOWER(type) LIKE ? OR LOWER(COALESCE(canonical_key, '')) LIKE ?)",
        params: [`%${term}%`, `%${term}%`, `%${term}%`]
      }))
      const filters = buildFilters([
        { sql: "status = ?", params: ["active"] },
        inFilter("scope_key", query.scopeKeys),
        ...searchFilters
      ])

      return select(db, `
        SELECT *
        FROM memory_records
        ${filters.where}
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `, [...filters.params, query.limit ?? 100]).map(memoryFromRow)
    },

    async linkSource(source: MemorySource): Promise<void> {
      const db = await database()
      db.run(`
        INSERT INTO memory_sources (memory_id, event_id, quote, reason)
        VALUES (?, ?, ?, ?)
      `, [
        source.memoryId,
        source.eventId,
        source.quote ?? null,
        source.reason
      ])
      await persist(db)
    },

    async upsertEmbedding(embedding: MemoryEmbedding): Promise<void> {
      const db = await database()
      db.run(`
        INSERT INTO memory_embeddings (
          owner_type, owner_id, model, dimensions, vector_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_type, owner_id) DO UPDATE SET
          model = excluded.model,
          dimensions = excluded.dimensions,
          vector_json = excluded.vector_json,
          created_at = excluded.created_at
      `, [
        embedding.ownerType,
        embedding.ownerId,
        embedding.model,
        embedding.dimensions,
        JSON.stringify(embedding.vector),
        embedding.createdAt
      ])
      await persist(db)
    },

    async searchEmbeddings(query: VectorQuery): Promise<VectorResult[]> {
      const db = await database()
      const filters = buildFilters([
        { sql: "m.status = ?", params: ["active"] },
        { sql: "e.owner_type = ?", params: ["memory"] },
        inFilter("m.scope_key", query.scopeKeys)
      ])
      const rows = select(db, `
        SELECT e.owner_type, e.owner_id, e.vector_json
        FROM memory_embeddings e
        JOIN memory_records m ON m.id = e.owner_id
        ${filters.where}
      `, filters.params)

      return rows
        .map((row): VectorResult => ({
          ownerType: String(row.owner_type),
          ownerId: String(row.owner_id),
          score: cosineSimilarity(query.vector, parseJsonArray(row.vector_json))
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit ?? 20)
    },

    async deleteMemory(memoryId: string): Promise<void> {
      const db = await database()
      db.run("UPDATE memory_records SET status = ?, updated_at = ? WHERE id = ?", [
        "deleted",
        new Date().toISOString(),
        memoryId
      ])
      await persist(db)
    },

    async forget(query: MemoryListQuery = {}): Promise<void> {
      const db = await database()
      const filters = buildFilters([inFilter("scope_key", query.scopeKeys)])
      const where = filters.where || "WHERE 1 = 1"

      db.run(`
        DELETE FROM memory_sources
        WHERE memory_id IN (SELECT id FROM memory_records ${where})
      `, filters.params)
      db.run(`
        DELETE FROM memory_embeddings
        WHERE owner_id IN (SELECT id FROM memory_records ${where})
      `, filters.params)
      db.run(`DELETE FROM memory_records ${where}`, filters.params)
      db.run(`DELETE FROM memory_events ${where}`, filters.params)
      await persist(db)
    },

    async export(query: MemoryListQuery & { eventLimit?: number } = {}): Promise<MemoryExport> {
      const memories = await this.listMemories(query)
      const events = await this.listRecentEvents({ ...query, limit: query.eventLimit ?? 1000 })
      return { memories, events }
    }
  }
}

async function openDatabase(path: string): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile(file) {
      return file === "sql-wasm.wasm" ? sqlWasmUrl() : file
    }
  })

  const existing = await readDatabase(path)
  const db = existing ? new SQL.Database(existing) : new SQL.Database()
  runMigrations(db)
  return db
}

async function readDatabase(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function runMigrations(db: Database): void {
  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS memory_events (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      thread_id TEXT,
      operation_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_events_scope_created_idx
      ON memory_events(scope_key, created_at);
    CREATE INDEX IF NOT EXISTS memory_events_thread_operation_idx
      ON memory_events(thread_id, operation_id);

    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      canonical_key TEXT,
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      sensitivity TEXT NOT NULL,
      status TEXT NOT NULL,
      source_event_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS memory_records_scope_canonical_idx
      ON memory_records(scope_key, canonical_key)
      WHERE canonical_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS memory_records_scope_status_idx
      ON memory_records(scope_key, status);
    CREATE INDEX IF NOT EXISTS memory_records_content_idx
      ON memory_records(content);

    CREATE TABLE IF NOT EXISTS memory_sources (
      memory_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      quote TEXT,
      reason TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_sources_memory_idx
      ON memory_sources(memory_id);

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(owner_type, owner_id)
    );

    CREATE INDEX IF NOT EXISTS memory_embeddings_owner_idx
      ON memory_embeddings(owner_type, owner_id);
  `)
}

function findExistingMemory(db: Database, record: MemoryRecord): { id: string; createdAt: string } | null {
  const rows = record.canonicalKey
    ? select(db, `
        SELECT id, created_at
        FROM memory_records
        WHERE id = ? OR (scope_key = ? AND canonical_key = ?)
        LIMIT 1
      `, [record.id, record.scopeKey, record.canonicalKey])
    : select(db, "SELECT id, created_at FROM memory_records WHERE id = ? LIMIT 1", [record.id])

  const first = rows[0]
  if (!first) return null
  return {
    id: String(first.id),
    createdAt: String(first.created_at)
  }
}

function eventFromRow(row: Record<string, unknown>): MemoryEvent {
  return {
    id: String(row.id),
    scopeKey: String(row.scope_key),
    threadId: nullableString(row.thread_id),
    operationId: nullableString(row.operation_id),
    role: row.role as MemoryEvent["role"],
    content: String(row.content),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: String(row.created_at)
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
    sourceEventIds: parseJsonArray(row.source_event_ids_json).map(String),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  }
}

type Filter = {
  sql: string
  params: unknown[]
}

function buildFilters(filters: Array<Filter | null>): { where: string; params: unknown[] } {
  const active = filters.filter((filter): filter is Filter => Boolean(filter))
  if (active.length === 0) return { where: "", params: [] }

  return {
    where: `WHERE ${active.map((filter) => filter.sql).join(" AND ")}`,
    params: active.flatMap((filter) => filter.params)
  }
}

function inFilter(column: string, values: string[] | undefined, negate = false): Filter | null {
  if (!values || values.length === 0) return null
  const operator = negate ? "NOT IN" : "IN"
  return {
    sql: `${column} ${operator} (${values.map(() => "?").join(", ")})`,
    params: values
  }
}

function select(db: Database, sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
  const stmt = db.prepare(sql)
  const rows: Array<Record<string, unknown>> = []

  try {
    stmt.bind(params)
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
  } finally {
    stmt.free()
  }

  return rows
}

function tokenizeSearch(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function parseJsonArray(value: unknown): number[] {
  if (typeof value !== "string") return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.map(Number) : []
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {}
  const parsed = JSON.parse(value) as unknown
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value)
}

function cosineSimilarity(a: number[] = [], b: number[] = []): number {
  let dot = 0
  let aLength = 0
  let bLength = 0
  const length = Math.max(a.length, b.length)

  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    dot += av * bv
    aLength += av * av
    bLength += bv * bv
  }

  if (aLength === 0 || bLength === 0) return 0
  return dot / (Math.sqrt(aLength) * Math.sqrt(bLength))
}

function sqlWasmUrl(): string {
  const require = createRequire(import.meta.url)
  return pathToFileURL(require.resolve("sql.js/dist/sql-wasm.wasm")).toString()
}
