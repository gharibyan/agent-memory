import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const repositoryUrl = "git+https://github.com/gharibyan/agent-memory.git"

async function read(path) {
  return readFile(new URL(path, root), "utf8")
}

async function readJson(path) {
  return JSON.parse(await read(path))
}

async function listFiles(dir = ".") {
  const entries = await readdir(new URL(dir, root), { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.includes("node_modules"))
    .filter((path) => !path.includes(`${join(".", "dist")}`))
    .filter((path) => !path.includes(`${join(".", ".git")}`))
    .filter((path) => !path.endsWith(`${join(".", ".env")}`))
    .filter((path) => !/\.env\.(?!example$)/.test(path))
}

test("root README and MIT license are present", async () => {
  const readme = await read("README.md")
  const license = await read("LICENSE")

  assert.match(readme, /^# agent-memory/m)
  assert.match(readme, /MIT License/)
  assert.match(license, /^MIT License/m)
  assert.match(license, /Gharibyan/)
})

test("workspace packages point to the gharibyan GitHub repository", async () => {
  for (const path of [
    "package.json",
    "packages/agent-memory/package.json",
    "packages/anthropic/package.json",
    "packages/core/package.json",
    "packages/gemini/package.json",
    "packages/local/package.json",
    "packages/sqlite/package.json",
    "packages/postgres/package.json",
    "packages/openai/package.json",
    "packages/xai/package.json"
  ]) {
    const packageJson = await readJson(path)

    assert.equal(packageJson.author, "Gharibyan")
    assert.equal(packageJson.license, "MIT")
    assert.equal(packageJson.repository.type, "git")
    assert.equal(packageJson.repository.url, repositoryUrl)
    assert.equal(packageJson.bugs.url, "https://github.com/gharibyan/agent-memory/issues")
    assert.equal(packageJson.homepage, "https://github.com/gharibyan/agent-memory#readme")
  }
})

test("github codeowners routes repository changes to gharibyan", async () => {
  const codeowners = await read(".github/CODEOWNERS")

  assert.match(codeowners, /^\* @gharibyan$/m)
})

test("gitignore excludes local IDE project settings", async () => {
  const gitignore = await read(".gitignore")

  assert.match(gitignore, /^\.idea\/$/m)
  assert.match(gitignore, /^\.env$/m)
  assert.match(gitignore, /^\.env\.\*$/m)
  assert.match(gitignore, /^!\.env\.example$/m)
  assert.match(gitignore, /^!apps\/\*\*\/\.env\.example$/m)
})

test("public repo files do not mention assistant-specific tooling", async () => {
  const files = await listFiles()
  const checked = await Promise.all(files.map(async (file) => [file, await read(file)]))
  const blocked = [
    new RegExp("co" + "dex", "i"),
    new RegExp("clau" + "de", "i")
  ]

  for (const [file, content] of checked) {
    for (const pattern of blocked) {
      assert.doesNotMatch(content, pattern, file)
    }
  }
})
