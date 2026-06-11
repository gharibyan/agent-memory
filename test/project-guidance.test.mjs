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
  assert.match(content, /@agent-memory\/core/)
  assert.match(content, /@agent-memory\/local/)
  assert.match(content, /@agent-memory\/sqlite/)
  assert.match(content, /@agent-memory\/openai/)
  assert.match(content, /official `openai` SDK/)
  assert.match(content, /official SDK/)
})

test("real OpenAI SQLite demo documents server-side setup", async () => {
  const readme = await read("apps/openai-sqlite-demo/README.md")
  const envExample = await read("apps/openai-sqlite-demo/.env.example")
  const server = await read("apps/openai-sqlite-demo/server.mjs")

  assert.match(readme, /OPENAI_API_KEY/)
  assert.match(readme, /server-side/)
  assert.match(readme, /sqliteMemory/)
  assert.match(envExample, /^OPENAI_API_KEY=$/m)
  assert.doesNotMatch(envExample, /sk-[A-Za-z0-9]/)
  assert.match(server, /process\.env\.OPENAI_API_KEY/)
  assert.match(server, /openai\(/)
  assert.match(server, /sqliteMemory\(/)
  assert.match(server, /hasOpenAIKey/)
  assert.doesNotMatch(server.match(/function page\(\) \{[^]*$/)?.[0] ?? "", /OPENAI_API_KEY/)
})

test("real OpenAI SQLite demo teaches scenarios and memory flow", async () => {
  const readme = await read("apps/openai-sqlite-demo/README.md")
  const server = await read("apps/openai-sqlite-demo/server.mjs")

  assert.match(readme, /Customer support/)
  assert.match(readme, /Sales CRM/)
  assert.match(readme, /Personal assistant/)
  assert.match(readme, /Product ops/)
  assert.match(server, /const scenarios = \[/)
  assert.match(server, /customer-support/)
  assert.match(server, /sales-crm/)
  assert.match(server, /personal-assistant/)
  assert.match(server, /product-ops/)
  assert.match(server, /scenarioTimeline/)
  assert.match(server, /memoryFlow/)
  assert.match(server, /whatHappened/)
  assert.match(server, /howItWorks/)
  assert.match(server, /memoriesUsed/)
  assert.match(server, /memoriesCreated/)
  assert.match(server, /Run scenario step/)
  assert.match(server, /Try recall/)
})
