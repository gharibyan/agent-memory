import { readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const VERSION_TAG_PATTERN = /^v?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/

export async function syncVersionFromTag(tag, options = {}) {
  const match = String(tag ?? "").match(VERSION_TAG_PATTERN)
  if (!match) {
    throw new Error(`Expected a semver tag like v1.2.3, received: ${tag || "<empty>"}`)
  }

  const rootDir = options.rootDir ?? process.cwd()
  const packagePaths = options.packagePaths ?? await findPublishablePackagePaths(rootDir)
  const updatedPackagePaths = []

  for (const packagePath of packagePaths) {
    const fullPath = resolve(rootDir, packagePath)
    const packageJson = JSON.parse(await readFile(fullPath, "utf8"))
    packageJson.version = match[1]
    await writeFile(fullPath, `${JSON.stringify(packageJson, null, 2)}\n`)
    updatedPackagePaths.push(packagePath)
  }

  return {
    updatedPackagePaths,
    version: match[1]
  }
}

async function findPublishablePackagePaths(rootDir) {
  const packagesDir = resolve(rootDir, "packages")
  const entries = await readdir(packagesDir, { withFileTypes: true })
  const packagePaths = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const fullPath = join(packagesDir, entry.name, "package.json")
    const packageJson = JSON.parse(await readFile(fullPath, "utf8"))
    if (packageJson.private === true) continue
    packagePaths.push(relative(rootDir, fullPath))
  }

  return packagePaths.sort()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await syncVersionFromTag(process.argv[2] ?? process.env.GITHUB_REF_NAME)
  console.log(`Updated ${result.updatedPackagePaths.join(", ")} to ${result.version}`)
}
