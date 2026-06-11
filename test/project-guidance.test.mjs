import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const root = new URL("../", import.meta.url)

async function read(path) {
  return readFile(new URL(path, root), "utf8")
}

test("agent guidance file describes package boundaries and verification", async () => {
  const content = await read("AGENTS.md")

  assert.match(content, /@agent-memory\/core/)
  assert.match(content, /@agent-memory\/local/)
  assert.match(content, /@agent-memory\/sqlite/)
  assert.match(content, /@agent-memory\/openai/)
  assert.match(content, /pnpm test/)
  assert.match(content, /pnpm lint/)
  assert.match(content, /pnpm pack:check/)
})

test("agent-memory skill captures SDK usage and extension patterns", async () => {
  const content = await read("skills/agent-memory/SKILL.md")

  assert.match(content, /^---\nname: agent-memory-sdk\n/m)
  assert.match(content, /description: Use when/)
  assert.match(content, /createAgent/)
  assert.match(content, /operationId/)
  assert.match(content, /\.memory\/memory\.json/)
  assert.match(content, /@agent-memory\/core/)
  assert.match(content, /@agent-memory\/local/)
  assert.match(content, /@agent-memory\/sqlite/)
  assert.match(content, /@agent-memory\/openai/)
})
