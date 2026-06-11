import { access, cp, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const firstPartyPackages = [
  { dir: "anthropic", name: "@agent-memory/anthropic" },
  { dir: "core", name: "@agent-memory/core" },
  { dir: "gemini", name: "@agent-memory/gemini" },
  { dir: "local", name: "@agent-memory/local" },
  { dir: "openai", name: "@agent-memory/openai" },
  { dir: "postgres", name: "@agent-memory/postgres" },
  { dir: "sqlite", name: "@agent-memory/sqlite" },
  { dir: "xai", name: "@agent-memory/xai" }
]

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const publicDistDir = resolve(rootDir, "packages", "agent-memory", "dist")
const internalDistDir = resolve(publicDistDir, "internal")

export async function bundlePublicPackage() {
  await assertBuiltPublicPackage()

  for (const packageInfo of firstPartyPackages) {
    await copyInternalPackage(packageInfo.dir)
  }

  await rewriteFirstPartySpecifiers(publicDistDir)
}

async function assertBuiltPublicPackage() {
  const entrypoint = resolve(publicDistDir, "index.js")

  try {
    await access(entrypoint)
  } catch {
    throw new Error("Expected packages/agent-memory/dist/index.js. Run the public package TypeScript build first.")
  }
}

async function copyInternalPackage(dir) {
  const sourceDir = resolve(rootDir, "packages", dir, "dist")
  const destinationDir = resolve(internalDistDir, dir)

  try {
    await access(resolve(sourceDir, "index.js"))
    await access(resolve(sourceDir, "index.d.ts"))
  } catch {
    throw new Error(`Expected packages/${dir}/dist to exist before bundling agent-memory. Run pnpm build from the repo root.`)
  }

  await cp(sourceDir, destinationDir, {
    recursive: true,
    filter: (source) => !source.endsWith(".tsbuildinfo")
  })
}

async function rewriteFirstPartySpecifiers(dir) {
  const files = await listFiles(dir)
  const rewritableFiles = files.filter((file) => file.endsWith(".js") || file.endsWith(".d.ts"))

  for (const file of rewritableFiles) {
    let content = await readFile(file, "utf8")

    for (const packageInfo of firstPartyPackages) {
      const internalEntrypoint = resolve(internalDistDir, packageInfo.dir, "index.js")
      const replacement = toModuleSpecifier(relative(dirname(file), internalEntrypoint))

      content = content.split(packageInfo.name).join(replacement)
    }

    await writeFile(file, content)
  }
}

async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
}

function toModuleSpecifier(relativePath) {
  const normalized = relativePath.split(sep).join("/")

  return normalized.startsWith(".") ? normalized : `./${normalized}`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await bundlePublicPackage()
}
