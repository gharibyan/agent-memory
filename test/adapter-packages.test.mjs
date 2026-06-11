import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const root = new URL("../", import.meta.url)

async function read(path) {
  return readFile(new URL(path, root), "utf8")
}

async function readJson(path) {
  return JSON.parse(await read(path))
}

test("openai-compatible provider lives in its own internal adapter package", async () => {
  const packageJson = await readJson("packages/openai/package.json")
  const source = await read("packages/openai/src/index.ts")
  const coreIndex = await read("packages/core/src/index.ts")

  assert.equal(packageJson.name, "@agent-memory/openai")
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.main, "./dist/index.js")
  assert.equal(packageJson.types, "./dist/index.d.ts")
  assert.deepEqual(packageJson.files, ["dist", "README.md", "package.json"])
  assert.equal(packageJson.dependencies["@agent-memory/core"], "workspace:*")
  assert.match(packageJson.dependencies.openai, /^\^/)
  assert.match(source, /from "openai"/)
  assert.match(source, /export function openAICompatible/)
  assert.match(source, /export function openai/)
  assert.doesNotMatch(source, /fetch\(/)
  assert.doesNotMatch(source, /chat\/completions/)
  assert.doesNotMatch(coreIndex, /openAICompatible/)
  assert.doesNotMatch(coreIndex, /openai/)
})

test("local persistence lives in its own internal storage adapter package", async () => {
  const packageJson = await readJson("packages/local/package.json")
  const source = await read("packages/local/src/index.ts")
  const coreIndex = await read("packages/core/src/index.ts")

  assert.equal(packageJson.name, "@agent-memory/local")
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.main, "./dist/index.js")
  assert.equal(packageJson.types, "./dist/index.d.ts")
  assert.deepEqual(packageJson.files, ["dist", "README.md", "package.json"])
  assert.equal(packageJson.dependencies["@agent-memory/core"], "workspace:*")
  assert.match(source, /export function localMemory/)
  assert.doesNotMatch(source, /export function sqliteMemory/)
  assert.doesNotMatch(coreIndex, /localMemory/)
  assert.doesNotMatch(coreIndex, /sqliteMemory/)
})

test("sqlite persistence lives in its own internal storage adapter package", async () => {
  const packageJson = await readJson("packages/sqlite/package.json")
  const source = await read("packages/sqlite/src/index.ts")
  const coreIndex = await read("packages/core/src/index.ts")

  assert.equal(packageJson.name, "@agent-memory/sqlite")
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.main, "./dist/index.js")
  assert.equal(packageJson.types, "./dist/index.d.ts")
  assert.deepEqual(packageJson.files, ["dist", "README.md", "package.json"])
  assert.equal(packageJson.dependencies["@agent-memory/core"], "workspace:*")
  assert.match(packageJson.dependencies["sql.js"], /^\^/)
  assert.match(source, /CREATE TABLE IF NOT EXISTS memory_records/)
  assert.match(source, /export function sqliteMemory/)
  assert.doesNotMatch(coreIndex, /sql.js/)
  assert.doesNotMatch(coreIndex, /sqliteMemory/)
})

test("postgres persistence lives in its own internal storage adapter package", async () => {
  const packageJson = await readJson("packages/postgres/package.json")
  const source = await read("packages/postgres/src/index.ts")
  const coreIndex = await read("packages/core/src/index.ts")

  assert.equal(packageJson.name, "@agent-memory/postgres")
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.main, "./dist/index.js")
  assert.equal(packageJson.types, "./dist/index.d.ts")
  assert.deepEqual(packageJson.files, ["dist", "README.md", "package.json"])
  assert.equal(packageJson.dependencies["@agent-memory/core"], "workspace:*")
  assert.match(packageJson.dependencies.pg, /^\^/)
  assert.match(source, /CREATE EXTENSION IF NOT EXISTS vector/)
  assert.match(source, /CREATE TABLE IF NOT EXISTS/)
  assert.match(source, /export function postgresMemory/)
  assert.doesNotMatch(coreIndex, /pg/)
  assert.doesNotMatch(coreIndex, /postgresMemory/)
})

test("public package re-exports internal adapters as convenience imports", async () => {
  const packageJson = await readJson("packages/agent-memory/package.json")
  const source = await read("packages/agent-memory/src/index.ts")

  assert.equal(Object.keys(packageJson.dependencies).some((name) => name.startsWith("@agent-memory/")), false)
  assert.match(packageJson.dependencies.openai, /^\^/)
  assert.match(packageJson.dependencies.pg, /^\^/)
  assert.match(packageJson.dependencies["sql.js"], /^\^/)
  assert.match(source, /export \* from "@agent-memory\/core"/)
  assert.match(source, /export \{ openAICompatible, openai \} from "@agent-memory\/openai"/)
  assert.match(source, /export \{ localMemory \} from "@agent-memory\/local"/)
  assert.match(source, /export \{ sqliteMemory \} from "@agent-memory\/sqlite"/)
  assert.match(source, /export \{ postgresMemory \} from "@agent-memory\/postgres"/)
})

test("built openai adapter exposes OpenAI-compatible provider helpers", async () => {
  const { openAICompatible, openai } = await import("../packages/openai/dist/index.js")

  const custom = openAICompatible({
    id: "deepseek-test",
    model: "deepseek-chat",
    baseURL: "https://api.deepseek.com",
    apiKey: "test-key"
  })
  const firstParty = openai("gpt-test", {
    apiKey: "test-key"
  })

  assert.equal(custom.id, "deepseek-test")
  assert.equal(custom.capabilities.streaming, true)
  assert.equal(custom.capabilities.tools, true)
  assert.equal(custom.capabilities.jsonSchema, true)
  assert.equal(firstParty.id, "openai:gpt-test")
})

test("built local adapter exposes persistent local memory helpers", async () => {
  const { localMemory } = await import("../packages/local/dist/index.js")

  assert.equal(localMemory().kind, "local-file")
})

test("built sqlite adapter exposes real SQLite memory helper", async () => {
  const { sqliteMemory } = await import("../packages/sqlite/dist/index.js")

  assert.equal(sqliteMemory().kind, "sqlite")
})

test("built postgres adapter exposes pgvector-backed memory helper", async () => {
  const { postgresMemory } = await import("../packages/postgres/dist/index.js")

  assert.equal(postgresMemory({ pool: createNoopPool() }).kind, "postgres")
})

function createNoopPool() {
  return {
    async query() {
      return { rows: [] }
    }
  }
}
