import assert from "node:assert/strict"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  createAgent,
  createMemoryStore,
  customModel,
  localMemory,
  makeEvent
} from "../dist/index.js"

test("generate stores a durable memory and recalls it on the next call", async () => {
  const seenRequests = []
  const agent = createAgent({
    model: customModel({
      id: "test-model",
      generate: async (request) => {
        seenRequests.push(request)
        return { text: "ok" }
      }
    }),
    memory: createMemoryStore()
  })

  const first = await agent.generate({
    userId: "user_1",
    messages: [
      { role: "user", content: "Remember that I prefer concise weekly reports." }
    ],
    debug: true
  })

  assert.equal(first.text, "ok")
  assert.equal(first.memory?.created.length, 1)
  assert.match(first.memory?.created[0]?.content ?? "", /prefers? concise weekly reports/i)

  const second = await agent.generate({
    userId: "user_1",
    messages: [
      { role: "user", content: "Write this week's update." }
    ],
    debug: true
  })

  assert.equal(second.text, "ok")
  assert.equal(second.memory?.used.length, 1)
  assert.match(second.memory?.used[0]?.content ?? "", /prefers? concise weekly reports/i)

  const recalledRequest = seenRequests.at(-1)

  assert.equal(recalledRequest.messages[0]?.role, "system")
  assert.match(recalledRequest.messages[0]?.content ?? "", /Relevant memory/i)
  assert.match(recalledRequest.messages[0]?.content ?? "", /prefers? concise weekly reports/i)
})

test("memories are isolated by userId and forget removes a user's memory", async () => {
  const store = createMemoryStore()
  const agent = createAgent({
    model: customModel({
      id: "test-model",
      generate: async () => ({ text: "ok" })
    }),
    memory: store
  })

  await agent.generate({
    userId: "alice",
    messages: [{ role: "user", content: "Remember that I prefer CSV exports." }]
  })

  const alice = await agent.memory.list({ userId: "alice" })
  const bob = await agent.memory.list({ userId: "bob" })

  assert.equal(alice.length, 1)
  assert.equal(bob.length, 0)

  await agent.memory.forget({ userId: "alice" })

  const afterForget = await agent.memory.list({ userId: "alice" })
  assert.equal(afterForget.length, 0)
})

test("generate without userId writes to the default scope", async () => {
  const agent = createAgent({
    model: customModel({
      id: "test-model",
      generate: async () => ({ text: "ok" })
    }),
    memory: createMemoryStore()
  })

  await agent.generate({
    messages: [{ role: "user", content: "Remember that I prefer short answers." }]
  })

  const memories = await agent.memory.list({})

  assert.equal(memories.length, 1)
  assert.match(memories[0]?.content ?? "", /prefers? short answers/i)
})

test("stream returns text and commits memory after consumption", async () => {
  const agent = createAgent({
    model: customModel({
      id: "test-model",
      async *stream() {
        yield "st"
        yield "ream"
      }
    }),
    memory: createMemoryStore()
  })

  const stream = await agent.stream({
    userId: "stream_user",
    messages: [{ role: "user", content: "Remember that I prefer markdown." }]
  })

  const text = await stream.text()
  assert.equal(text, "stream")

  const memories = await agent.memory.list({ userId: "stream_user" })
  assert.equal(memories.length, 1)
  assert.match(memories[0]?.content ?? "", /prefers? markdown/i)
})

test("localMemory defaults to .memory persistence in the project root", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "agent-memory-local-"))
  const previousCwd = process.cwd()

  try {
    process.chdir(tempDir)
    const store = localMemory()

    await store.writeEvent(makeEvent({
      scopeKey: "user:local",
      role: "user",
      content: "Remember that local persistence lives in .memory."
    }))

    const content = await readFile(join(tempDir, ".memory", "memory.json"), "utf8")
    const state = JSON.parse(content)

    assert.equal(state.events.length, 1)
    await assert.rejects(access(join(tempDir, ".ai-memory", "memory.json")))
  } finally {
    process.chdir(previousCwd)
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("public createAgent defaults to automatic .memory persistence", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "agent-memory-auto-"))
  const previousCwd = process.cwd()

  try {
    process.chdir(tempDir)
    const agent = createAgent({
      model: customModel({
        id: "test-model",
        generate: async () => ({ text: "ok" })
      })
    })

    await agent.generate({
      userId: "auto_user",
      messages: [
        { role: "user", content: "Remember that automatic memory should persist." }
      ]
    })

    const content = await readFile(join(tempDir, ".memory", "memory.json"), "utf8")
    const state = JSON.parse(content)

    assert.equal(state.memories.length, 1)
    assert.match(state.memories[0]?.content ?? "", /automatic memory should persist/i)
  } finally {
    process.chdir(previousCwd)
    await rm(tempDir, { recursive: true, force: true })
  }
})

test("generate packs recent operation context without pulling unrelated threads", async () => {
  const seenRequests = []
  const store = createMemoryStore()
  const agent = createAgent({
    model: customModel({
      id: "test-model",
      generate: async (request) => {
        seenRequests.push(request)
        return { text: "ok" }
      }
    }),
    memory: {
      store,
      contextBudget: 360
    }
  })

  await agent.generate({
    userId: "operator",
    threadId: "thread_plan",
    operationId: "op_migration",
    messages: [
      { role: "user", content: "The migration file is db/migrations/001_init.sql." }
    ],
    memory: { learn: false }
  })

  await agent.generate({
    userId: "operator",
    threadId: "thread_other",
    operationId: "op_billing",
    messages: [
      { role: "user", content: "The unrelated billing note mentions Stripe invoices." }
    ],
    memory: { learn: false }
  })

  await agent.generate({
    userId: "operator",
    threadId: "thread_plan",
    operationId: "op_migration",
    messages: [
      { role: "user", content: "Which migration file should I inspect next?" }
    ],
    memory: { learn: false },
    debug: true
  })

  const recalledRequest = seenRequests.at(-1)
  const context = recalledRequest.messages[0]

  assert.equal(context.role, "system")
  assert.match(context.content, /Recent operation context/i)
  assert.match(context.content, /db\/migrations\/001_init\.sql/)
  assert.doesNotMatch(context.content, /Stripe invoices/)
  assert.ok(context.content.length <= 360)
})
