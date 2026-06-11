import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

const root = new URL("../", import.meta.url)

async function read(path) {
  return readFile(new URL(path, root), "utf8")
}

async function readJson(path) {
  return JSON.parse(await read(path))
}

test("github ci runs lint, tests, and package boundary check", async () => {
  const workflow = await read(".github/workflows/test.yml")

  assert.match(workflow, /on:/)
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /push:/)
  assert.match(workflow, /pnpm build/)
  assert.match(workflow, /pnpm test/)
  assert.match(workflow, /pnpm lint/)
  assert.match(workflow, /pnpm --filter @agent-memory\/core pack --dry-run/)
  assert.match(workflow, /pnpm --filter @agent-memory\/local pack --dry-run/)
  assert.match(workflow, /pnpm --filter @agent-memory\/sqlite pack --dry-run/)
  assert.match(workflow, /pnpm --filter @agent-memory\/openai pack --dry-run/)
  assert.match(workflow, /pnpm --filter agent-memory pack --dry-run/)
})

test("github publish workflow is tag gated and syncs package version from tag", async () => {
  const workflow = await read(".github/workflows/publish.yml")

  assert.match(workflow, /tags:/)
  assert.match(workflow, /'v\*'/)
  assert.match(workflow, /NODE_AUTH_TOKEN/)
  assert.match(workflow, /NPM_TOKEN/)
  assert.match(workflow, /scripts\/sync-package-version-from-tag\.mjs/)
  assert.match(workflow, /pnpm build/)
  assert.match(workflow, /pnpm --filter @agent-memory\/core publish --access public --no-git-checks/)
  assert.match(workflow, /pnpm --filter @agent-memory\/local publish --access public --no-git-checks/)
  assert.match(workflow, /pnpm --filter @agent-memory\/sqlite publish --access public --no-git-checks/)
  assert.match(workflow, /pnpm --filter @agent-memory\/openai publish --access public --no-git-checks/)
  assert.match(workflow, /pnpm --filter agent-memory publish --access public --no-git-checks/)
})

test("root package exposes lint and version sync scripts", async () => {
  const packageJson = await readJson("package.json")

  assert.equal(packageJson.scripts.build, "pnpm --filter @agent-memory/core build && pnpm --filter @agent-memory/local build && pnpm --filter @agent-memory/sqlite build && pnpm --filter @agent-memory/openai build && pnpm --filter agent-memory build")
  assert.equal(packageJson.scripts.lint, "eslint .")
  assert.equal(packageJson.scripts["version:from-tag"], "node scripts/sync-package-version-from-tag.mjs")
})

test("eslint config ignores local memory and package artifacts", async () => {
  const config = await read("eslint.config.js")

  assert.match(config, /\.memory/)
  assert.match(config, /\.ai-memory/)
  assert.match(config, /agent-memory-\*\.tgz/)
  assert.match(config, /no-unused-vars/)
  assert.match(config, /semi/)
})

test("version sync script updates the publishable package from a v-prefixed tag", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "agent-memory-version-test-"))

  try {
    const { mkdir } = await import("node:fs/promises")
    const publicPackageDir = join(tempDir, "packages", "agent-memory")
    const corePackageDir = join(tempDir, "packages", "core")
    const localPackageDir = join(tempDir, "packages", "local")
    const openaiPackageDir = join(tempDir, "packages", "openai")
    const sqlitePackageDir = join(tempDir, "packages", "sqlite")
    await mkdir(publicPackageDir, { recursive: true })
    await mkdir(corePackageDir, { recursive: true })
    await mkdir(localPackageDir, { recursive: true })
    await mkdir(openaiPackageDir, { recursive: true })
    await mkdir(sqlitePackageDir, { recursive: true })
    await writeFile(join(publicPackageDir, "package.json"), JSON.stringify({
      name: "agent-memory",
      version: "0.0.0"
    }, null, 2))
    await writeFile(join(corePackageDir, "package.json"), JSON.stringify({
      name: "@agent-memory/core",
      version: "0.0.0"
    }, null, 2))
    await writeFile(join(localPackageDir, "package.json"), JSON.stringify({
      name: "@agent-memory/local",
      version: "0.0.0"
    }, null, 2))
    await writeFile(join(openaiPackageDir, "package.json"), JSON.stringify({
      name: "@agent-memory/openai",
      version: "0.0.0"
    }, null, 2))
    await writeFile(join(sqlitePackageDir, "package.json"), JSON.stringify({
      name: "@agent-memory/sqlite",
      version: "0.0.0"
    }, null, 2))

    const { syncVersionFromTag } = await import(pathToFileURL(new URL("scripts/sync-package-version-from-tag.mjs", root).pathname))
    const result = await syncVersionFromTag("v1.2.3", {
      rootDir: tempDir
    })
    const packageJson = JSON.parse(await readFile(join(publicPackageDir, "package.json"), "utf8"))
    const corePackageJson = JSON.parse(await readFile(join(corePackageDir, "package.json"), "utf8"))
    const localPackageJson = JSON.parse(await readFile(join(localPackageDir, "package.json"), "utf8"))
    const openaiPackageJson = JSON.parse(await readFile(join(openaiPackageDir, "package.json"), "utf8"))
    const sqlitePackageJson = JSON.parse(await readFile(join(sqlitePackageDir, "package.json"), "utf8"))

    assert.equal(result.version, "1.2.3")
    assert.deepEqual(result.updatedPackagePaths.sort(), [
      "packages/agent-memory/package.json",
      "packages/core/package.json",
      "packages/local/package.json",
      "packages/openai/package.json",
      "packages/sqlite/package.json"
    ].sort())
    assert.equal(packageJson.version, "1.2.3")
    assert.equal(corePackageJson.version, "1.2.3")
    assert.equal(localPackageJson.version, "1.2.3")
    assert.equal(openaiPackageJson.version, "1.2.3")
    assert.equal(sqlitePackageJson.version, "1.2.3")
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
