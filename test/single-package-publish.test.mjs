import assert from "node:assert/strict"
import { access, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const internalPackageDirs = [
  "anthropic",
  "core",
  "gemini",
  "local",
  "openai",
  "postgres",
  "sqlite",
  "xai"
]

async function exists(path) {
  try {
    await access(new URL(path, root))
    return true
  } catch {
    return false
  }
}

async function read(path) {
  return readFile(new URL(path, root), "utf8")
}

async function readJson(path) {
  return JSON.parse(await read(path))
}

async function listFiles(dir) {
  const entries = await readdir(new URL(dir, root), { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

test("only agent-memory is publishable from the workspace package set", async () => {
  const publicPackage = await readJson("packages/agent-memory/package.json")

  assert.equal(publicPackage.private, undefined)
  assert.equal(
    Object.keys(publicPackage.dependencies ?? {}).some((name) => name.startsWith("@agent-memory/")),
    false
  )

  for (const dir of internalPackageDirs) {
    const packageJson = await readJson(`packages/${dir}/package.json`)

    assert.equal(packageJson.private, true, `${packageJson.name} should be an internal workspace package`)
  }
})

test("agent-memory dist contains bundled first-party internals", async () => {
  for (const dir of internalPackageDirs) {
    assert.equal(
      await exists(`packages/agent-memory/dist/internal/${dir}/index.js`),
      true,
      `expected packages/agent-memory/dist/internal/${dir}/index.js to be packed with agent-memory`
    )
    assert.equal(
      await exists(`packages/agent-memory/dist/internal/${dir}/index.d.ts`),
      true,
      `expected packages/agent-memory/dist/internal/${dir}/index.d.ts to be packed with agent-memory`
    )
  }

  const distFiles = await listFiles("packages/agent-memory/dist")
  const importableFiles = distFiles.filter((file) => file.endsWith(".js") || file.endsWith(".d.ts"))
  const contents = await Promise.all(importableFiles.map((file) => read(file.replace(root.pathname, ""))))

  assert.equal(
    contents.some((content) => /from ["']@agent-memory\//.test(content)),
    false,
    "published dist files must not import unpublished @agent-memory/* packages"
  )
})

test("pack and publish automation only target the agent-memory npm package", async () => {
  const packageJson = await readJson("package.json")
  const testWorkflow = await read(".github/workflows/test.yml")
  const publishWorkflow = await read(".github/workflows/publish.yml")

  assert.match(packageJson.scripts["pack:check"], /pnpm --filter agent-memory pack --dry-run/)
  assert.doesNotMatch(packageJson.scripts["pack:check"], /@agent-memory\//)
  assert.match(testWorkflow, /pnpm --filter agent-memory pack --dry-run/)
  assert.doesNotMatch(testWorkflow, /@agent-memory\//)
  assert.match(publishWorkflow, /pnpm --filter agent-memory publish --access public --no-git-checks/)
  assert.doesNotMatch(publishWorkflow, /@agent-memory\/.* publish/)
})
