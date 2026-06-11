import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { makeEmbedding, makeEvent } from "../packages/core/dist/index.js"

test("sqliteMemory persists events, memories, sources, and embeddings to a SQLite database", async () => {
  const { sqliteMemory } = await import("../packages/sqlite/dist/index.js")
  const tempDir = await mkdtemp(join(tmpdir(), "agent-memory-sqlite-"))

  try {
    const path = join(tempDir, "memory.sqlite")
    const store = sqliteMemory({ path })
    const event = makeEvent({
      scopeKey: "user:sqlite",
      threadId: "thread_sqlite",
      operationId: "op_sqlite",
      role: "user",
      content: "Remember that SQLite search should find markdown preferences."
    })
    const now = new Date().toISOString()

    await store.writeEvent(event)
    const memory = await store.upsertMemory({
      id: "mem_sqlite",
      scopeKey: "user:sqlite",
      type: "preference",
      content: "User prefers markdown reports stored in SQLite.",
      canonicalKey: "preference:user-prefers-markdown-reports",
      confidence: 0.9,
      importance: 0.8,
      sensitivity: "normal",
      status: "active",
      sourceEventIds: [event.id],
      createdAt: now,
      updatedAt: now
    })
    await store.linkSource({
      memoryId: memory.id,
      eventId: event.id,
      quote: "prefers markdown",
      reason: "user stated a preference"
    })
    await store.upsertEmbedding({
      ownerType: "memory",
      ownerId: memory.id,
      model: "local-hash-v1",
      dimensions: 32,
      vector: makeEmbedding(memory.content),
      createdAt: now
    })

    const databaseBytes = await readFile(path)
    assert.equal(databaseBytes.subarray(0, 16).toString("utf8"), "SQLite format 3\u0000")

    const reopened = sqliteMemory({ path })
    const memories = await reopened.listMemories({ scopeKeys: ["user:sqlite"] })
    const searched = await reopened.searchMemories({ scopeKeys: ["user:sqlite"], query: "markdown", limit: 5 })
    const events = await reopened.listRecentEvents({
      scopeKeys: ["user:sqlite"],
      threadId: "thread_sqlite",
      operationId: "op_sqlite"
    })
    const vectors = await reopened.searchEmbeddings?.({
      scopeKeys: ["user:sqlite"],
      vector: makeEmbedding("markdown reports"),
      limit: 5
    })

    assert.equal(memories.length, 1)
    assert.equal(memories[0]?.id, "mem_sqlite")
    assert.equal(searched[0]?.id, "mem_sqlite")
    assert.equal(events.length, 1)
    assert.equal(events[0]?.id, event.id)
    assert.equal(vectors?.[0]?.ownerId, "mem_sqlite")

    const exported = await reopened.export({ scopeKeys: ["user:sqlite"] })
    assert.equal(exported.memories.length, 1)
    assert.equal(exported.events.length, 1)

    await reopened.forget({ scopeKeys: ["user:sqlite"] })
    assert.equal((await reopened.listMemories({ scopeKeys: ["user:sqlite"] })).length, 0)
    assert.equal((await reopened.listRecentEvents({ scopeKeys: ["user:sqlite"] })).length, 0)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
