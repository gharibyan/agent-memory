import assert from "node:assert/strict"
import { test } from "node:test"
import { makeEvent } from "../packages/core/dist/index.js"

test("postgresMemory runs versioned pgvector migrations automatically before first operation", async () => {
  const { postgresMemory } = await import("../packages/postgres/dist/index.js")
  const pool = createRecordingPool()
  const store = postgresMemory({ pool, vectorDimensions: 32 })
  const event = makeEvent({
    scopeKey: "user:pg",
    threadId: "thread_pg",
    operationId: "op_pg",
    role: "user",
    content: "Remember Postgres should migrate itself."
  })

  await store.writeEvent(event)
  await store.listRecentEvents({ scopeKeys: ["user:pg"], threadId: "thread_pg" })

  const sql = pool.queries.map((query) => normalizeSql(query.text)).join("\n")

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "public"\."agent_memory_migrations"/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "public"\."memory_events"/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "public"\."memory_records"/)
  assert.match(sql, /"embedding" vector\(32\)/)
  assert.match(sql, /USING hnsw \("embedding" vector_cosine_ops\)/)
  assert.equal(count(sql, /CREATE TABLE IF NOT EXISTS "public"\."memory_events"/g), 1)
  assert.equal(count(sql, /INSERT INTO "public"\."agent_memory_migrations"/g), 1)
})

test("postgresMemory rejects vectors that do not match the configured pgvector dimensions", async () => {
  const { postgresMemory } = await import("../packages/postgres/dist/index.js")
  const pool = createRecordingPool()
  const store = postgresMemory({ pool, vectorDimensions: 32 })

  await assert.rejects(
    store.upsertEmbedding({
      ownerType: "memory",
      ownerId: "mem_wrong_dimensions",
      model: "custom",
      dimensions: 3,
      vector: [0.1, 0.2, 0.3],
      createdAt: new Date().toISOString()
    }),
    /postgresMemory vectorDimensions is 32, but received a 3-dimension embedding/
  )
})

function createRecordingPool() {
  const appliedMigrations = new Set()
  const queries = []

  return {
    queries,
    async query(text, values = []) {
      queries.push({ text, values })

      if (/SELECT id FROM "public"\."agent_memory_migrations"/.test(text)) {
        const id = String(values[0])
        return { rows: appliedMigrations.has(id) ? [{ id }] : [] }
      }

      if (/INSERT INTO "public"\."agent_memory_migrations"/.test(text)) {
        appliedMigrations.add(String(values[0]))
      }

      return { rows: [] }
    }
  }
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim()
}

function count(value, expression) {
  return value.match(expression)?.length ?? 0
}
