import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

const root = new URL("../", import.meta.url)

async function readJson(path) {
  const content = await readFile(new URL(path, root), "utf8")
  return JSON.parse(content)
}

async function listFiles(dir) {
  const absolute = new URL(dir, root)
  const entries = await readdir(absolute, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

test("root and playground packages are private", async () => {
  const rootPackage = await readJson("package.json")
  const playgroundPackage = await readJson("apps/playground/package.json")

  assert.equal(rootPackage.private, true)
  assert.equal(playgroundPackage.private, true)
})

test("published agent-memory package uses a restrictive files allowlist", async () => {
  const packageJson = await readJson("packages/agent-memory/package.json")

  assert.equal(packageJson.private, undefined)
  assert.deepEqual(packageJson.files, [
    "dist",
    "README.md",
    "package.json"
  ])
  assert.equal(packageJson.files.includes("../../apps/playground"), false)
  assert.equal(packageJson.files.includes(".memory"), false)
  assert.equal(packageJson.files.includes(".ai-memory"), false)
})

test("published core package uses a restrictive files allowlist", async () => {
  const packageJson = await readJson("packages/core/package.json")
  const distFiles = await listFiles("packages/core/dist")

  assert.equal(packageJson.private, undefined)
  assert.deepEqual(packageJson.files, [
    "dist",
    "README.md",
    "package.json"
  ])
  assert.equal(packageJson.files.includes("../../apps/playground"), false)
  assert.equal(packageJson.files.includes(".memory"), false)
  assert.equal(packageJson.files.includes(".ai-memory"), false)
  assert.equal(distFiles.some((file) => file.includes("local-store")), false)
})

test("published local adapter package uses a restrictive files allowlist", async () => {
  const packageJson = await readJson("packages/local/package.json")

  assert.equal(packageJson.private, undefined)
  assert.deepEqual(packageJson.files, [
    "dist",
    "README.md",
    "package.json"
  ])
  assert.equal(packageJson.files.includes("../../apps/playground"), false)
  assert.equal(packageJson.files.includes(".memory"), false)
  assert.equal(packageJson.files.includes(".ai-memory"), false)
})

test("published sqlite adapter package uses a restrictive files allowlist", async () => {
  const packageJson = await readJson("packages/sqlite/package.json")

  assert.equal(packageJson.private, undefined)
  assert.deepEqual(packageJson.files, [
    "dist",
    "README.md",
    "package.json"
  ])
  assert.equal(packageJson.files.includes("../../apps/playground"), false)
  assert.equal(packageJson.files.includes(".memory"), false)
  assert.equal(packageJson.files.includes(".ai-memory"), false)
})

test("published postgres adapter package uses a restrictive files allowlist", async () => {
  const packageJson = await readJson("packages/postgres/package.json")

  assert.equal(packageJson.private, undefined)
  assert.deepEqual(packageJson.files, [
    "dist",
    "README.md",
    "package.json"
  ])
  assert.equal(packageJson.files.includes("../../apps/playground"), false)
  assert.equal(packageJson.files.includes(".memory"), false)
  assert.equal(packageJson.files.includes(".ai-memory"), false)
})

test("published openai adapter package uses a restrictive files allowlist", async () => {
  const packageJson = await readJson("packages/openai/package.json")

  assert.equal(packageJson.private, undefined)
  assert.deepEqual(packageJson.files, [
    "dist",
    "README.md",
    "package.json"
  ])
  assert.equal(packageJson.files.includes("../../apps/playground"), false)
  assert.equal(packageJson.files.includes(".memory"), false)
  assert.equal(packageJson.files.includes(".ai-memory"), false)
})
