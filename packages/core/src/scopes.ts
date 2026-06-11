import type { MemoryScopeInput, ResolvedMemoryScope } from "./types.js"

export function resolveScope(input: MemoryScopeInput = {}): ResolvedMemoryScope {
  const keys: string[] = []

  if (input.threadId) keys.push(`thread:${input.threadId}`)
  if (input.userId) keys.push(`user:${input.userId}`)
  if (input.orgId) keys.push(`org:${input.orgId}`)

  keys.push("default")

  return {
    primaryKey: input.userId
      ? `user:${input.userId}`
      : input.orgId
        ? `org:${input.orgId}`
        : "default",
    keys: [...new Set(keys)],
    targetKeys: targetScopeKeys(input)
  }
}

export function targetScopeKeys(input: MemoryScopeInput = {}): string[] {
  if (input.threadId) return [`thread:${input.threadId}`]
  if (input.userId) return [`user:${input.userId}`]
  if (input.orgId) return [`org:${input.orgId}`]
  return ["default"]
}

