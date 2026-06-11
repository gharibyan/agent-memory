import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

const root = new URL("../", import.meta.url)

async function read(path) {
  return readFile(new URL(path, root), "utf8")
}

async function readJson(path) {
  return JSON.parse(await read(path))
}

async function listFiles(dir, suffix) {
  const absolute = new URL(dir, root)
  const entries = await readdir(absolute, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => path.endsWith(suffix))
}

test("source implementation is TypeScript-first", async () => {
  const coreSource = await listFiles("packages/core/src", ".ts")
  const publicSource = await listFiles("packages/agent-memory/src", ".ts")
  const localSource = await listFiles("packages/local/src", ".ts")
  const openaiSource = await listFiles("packages/openai/src", ".ts")
  const postgresSource = await listFiles("packages/postgres/src", ".ts")
  const sqliteSource = await listFiles("packages/sqlite/src", ".ts")
  const javascriptSource = [
    ...await listFiles("packages/core/src", ".js"),
    ...await listFiles("packages/agent-memory/src", ".js"),
    ...await listFiles("packages/local/src", ".js"),
    ...await listFiles("packages/openai/src", ".js"),
    ...await listFiles("packages/postgres/src", ".js"),
    ...await listFiles("packages/sqlite/src", ".js")
  ]

  assert.ok(coreSource.length > 4)
  assert.ok(localSource.some((path) => path.endsWith("index.ts")))
  assert.ok(openaiSource.some((path) => path.endsWith("index.ts")))
  assert.ok(postgresSource.some((path) => path.endsWith("index.ts")))
  assert.ok(sqliteSource.some((path) => path.endsWith("index.ts")))
  assert.deepEqual(javascriptSource, [])
  assert.ok(publicSource.some((path) => path.endsWith("index.ts")))
})

test("package structure separates internal runtime, adapters, and public package", async () => {
  const corePackage = await readJson("packages/core/package.json")
  const localPackage = await readJson("packages/local/package.json")
  const openaiPackage = await readJson("packages/openai/package.json")
  const postgresPackage = await readJson("packages/postgres/package.json")
  const sqlitePackage = await readJson("packages/sqlite/package.json")
  const publicPackage = await readJson("packages/agent-memory/package.json")
  const publicIndex = await read("packages/agent-memory/src/index.ts")

  assert.equal(corePackage.name, "@agent-memory/core")
  assert.equal(corePackage.private, true)
  assert.equal(corePackage.main, "./dist/index.js")
  assert.equal(corePackage.types, "./dist/index.d.ts")
  assert.deepEqual(corePackage.files, ["dist", "README.md", "package.json"])

  assert.equal(publicPackage.name, "agent-memory")
  assert.equal(publicPackage.main, "./dist/index.js")
  assert.equal(publicPackage.types, "./dist/index.d.ts")
  assert.equal(Object.keys(publicPackage.dependencies).some((name) => name.startsWith("@agent-memory/")), false)
  assert.match(publicPackage.dependencies.openai, /^\^/)
  assert.match(publicPackage.dependencies.pg, /^\^/)
  assert.match(publicPackage.dependencies["sql.js"], /^\^/)
  assert.match(publicIndex, /export \* from "@agent-memory\/core"/)
  assert.match(publicIndex, /export \{ localMemory \} from "@agent-memory\/local"/)
  assert.match(publicIndex, /export \{ openAICompatible, openai \} from "@agent-memory\/openai"/)
  assert.match(publicIndex, /export \{ postgresMemory \} from "@agent-memory\/postgres"/)
  assert.match(publicIndex, /export \{ sqliteMemory \} from "@agent-memory\/sqlite"/)

  assert.equal(localPackage.name, "@agent-memory/local")
  assert.equal(localPackage.private, true)
  assert.equal(localPackage.main, "./dist/index.js")
  assert.equal(localPackage.types, "./dist/index.d.ts")
  assert.equal(localPackage.dependencies["@agent-memory/core"], "workspace:*")
  assert.deepEqual(localPackage.files, ["dist", "README.md", "package.json"])

  assert.equal(openaiPackage.name, "@agent-memory/openai")
  assert.equal(openaiPackage.private, true)
  assert.equal(openaiPackage.main, "./dist/index.js")
  assert.equal(openaiPackage.types, "./dist/index.d.ts")
  assert.equal(openaiPackage.dependencies["@agent-memory/core"], "workspace:*")
  assert.deepEqual(openaiPackage.files, ["dist", "README.md", "package.json"])

  assert.equal(postgresPackage.name, "@agent-memory/postgres")
  assert.equal(postgresPackage.private, true)
  assert.equal(postgresPackage.main, "./dist/index.js")
  assert.equal(postgresPackage.types, "./dist/index.d.ts")
  assert.equal(postgresPackage.dependencies["@agent-memory/core"], "workspace:*")
  assert.match(postgresPackage.dependencies.pg, /^\^/)
  assert.deepEqual(postgresPackage.files, ["dist", "README.md", "package.json"])

  assert.equal(sqlitePackage.name, "@agent-memory/sqlite")
  assert.equal(sqlitePackage.private, true)
  assert.equal(sqlitePackage.main, "./dist/index.js")
  assert.equal(sqlitePackage.types, "./dist/index.d.ts")
  assert.equal(sqlitePackage.dependencies["@agent-memory/core"], "workspace:*")
  assert.match(sqlitePackage.dependencies["sql.js"], /^\^/)
  assert.deepEqual(sqlitePackage.files, ["dist", "README.md", "package.json"])
})

test("root scripts build TypeScript before test and package checks", async () => {
  const packageJson = await readJson("package.json")

  assert.equal(packageJson.scripts.build, "pnpm --filter @agent-memory/core build && pnpm --filter @agent-memory/local build && pnpm --filter @agent-memory/sqlite build && pnpm --filter @agent-memory/postgres build && pnpm --filter @agent-memory/openai build && pnpm --filter agent-memory build")
  assert.match(packageJson.scripts.test, /pnpm build/)
  assert.equal(packageJson.scripts["pack:check"], "pnpm --filter agent-memory pack --dry-run")
  assert.match(packageJson.devDependencies.typescript, /^\^/)
})

test("core package stays runtime neutral", async () => {
  const coreFiles = await listFiles("packages/core/src", ".ts")
  const coreSource = await Promise.all(coreFiles.map((path) => read(path.replace(root.pathname, ""))))
  const combined = coreSource.join("\n")

  assert.doesNotMatch(combined, /node:fs/)
  assert.doesNotMatch(combined, /node:path/)
})
