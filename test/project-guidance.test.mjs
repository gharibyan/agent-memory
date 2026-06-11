import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const root = new URL("../", import.meta.url)

async function read(path) {
  return readFile(new URL(path, root), "utf8")
}

test("agent guidance file describes package boundaries and verification", async () => {
  const content = await read("AGENTS.md")

  assert.match(content, /packages\/core/)
  assert.match(content, /packages\/local/)
  assert.match(content, /packages\/sqlite/)
  assert.match(content, /packages\/openai/)
  assert.match(content, /only public npm package/)
  assert.match(content, /official `openai` SDK/)
  assert.match(content, /official provider SDKs/)
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
  assert.match(content, /packages\/core/)
  assert.match(content, /packages\/local/)
  assert.match(content, /packages\/sqlite/)
  assert.match(content, /packages\/openai/)
  assert.match(content, /only public npm package/)
  assert.match(content, /official `openai` SDK/)
  assert.match(content, /official SDK/)
})
