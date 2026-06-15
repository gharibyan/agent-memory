import { randomUUID } from "node:crypto"
import { canonicalKeyFor } from "./compiler.js"
import { makeEmbedding } from "./memory-store.js"
import type {
  AgentRole,
  MemoryEvent,
  MemoryMigrationEvent,
  MemoryMigrationInput,
  MemoryMigrationItem,
  MemoryMigrationMode,
  MemoryMigrationResult,
  MemoryRecord,
  MemoryStore
} from "./types.js"

const EXISTING_LOOKUP_LIMIT = 10000
const DEFAULT_CONFIDENCE = 0.85
const DEFAULT_IMPORTANCE = 0.6
const allowedModes = new Set<MemoryMigrationMode>(["upsert", "skipExisting"])
const allowedRoles = new Set<AgentRole>(["system", "user", "assistant", "tool"])
const allowedSensitivity = new Set<MemoryRecord["sensitivity"]>(["normal", "sensitive", "secret"])
const allowedStatus = new Set<MemoryRecord["status"]>(["active", "superseded", "deleted"])

export async function migrateMemory(input: {
  store: MemoryStore
  migration: MemoryMigrationInput
}): Promise<MemoryMigrationResult> {
  const mode = normalizeMode(input.migration.mode)
  const result: MemoryMigrationResult = {
    memories: {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    },
    events: {
      imported: 0,
      skipped: 0,
      failed: 0
    },
    failures: []
  }

  const events = input.migration.events ?? []
  for (let index = 0; index < events.length; index += 1) {
    try {
      const event = normalizeEvent(input.migration, events[index])
      if (mode === "skipExisting" && await hasExistingEvent(input.store, event)) {
        result.events.skipped += 1
        continue
      }

      await input.store.writeEvent(event)
      result.events.imported += 1
    } catch (error) {
      result.events.failed += 1
      result.failures.push({
        target: "event",
        index,
        reason: errorReason(error)
      })
    }
  }

  const memories = [...(input.migration.data ?? []), ...(input.migration.memories ?? [])]
  for (let index = 0; index < memories.length; index += 1) {
    try {
      const memory = normalizeMemory(input.migration, memories[index])
      const existing = await findExistingMemory(input.store, memory)
      if (mode === "skipExisting" && existing) {
        result.memories.skipped += 1
        continue
      }

      if (memory.sourceEventIds.length === 0) {
        const sourceEvent = syntheticSourceEvent(input.migration, memory)
        await input.store.writeEvent(sourceEvent)
        result.events.imported += 1
        memory.sourceEventIds = [sourceEvent.id]
      }

      const stored = await input.store.upsertMemory(memory)
      for (const eventId of memory.sourceEventIds) {
        await input.store.linkSource({
          memoryId: stored.id,
          eventId,
          reason: "Imported memory source."
        })
      }

      await input.store.upsertEmbedding({
        ownerType: "memory",
        ownerId: stored.id,
        model: "local-hash-v1",
        dimensions: 32,
        vector: makeEmbedding(stored.content),
        createdAt: stored.updatedAt
      })

      if (existing) {
        result.memories.updated += 1
      } else {
        result.memories.created += 1
      }
    } catch (error) {
      result.memories.failed += 1
      result.failures.push({
        target: "memory",
        index,
        reason: errorReason(error)
      })
    }
  }

  return result
}

function normalizeMode(mode: MemoryMigrationMode | undefined): MemoryMigrationMode {
  if (!mode) return "upsert"
  if (!allowedModes.has(mode)) {
    throw new Error(`Unsupported memory migration mode: ${mode}`)
  }
  return mode
}

function normalizeEvent(scope: MemoryMigrationInput, event: MemoryMigrationEvent | undefined): MemoryEvent {
  if (!event) throw new Error("Migration event is missing.")

  const role = event.role ?? "user"
  if (!allowedRoles.has(role)) {
    throw new Error(`Migration event role is unsupported: ${role}`)
  }

  return {
    id: optionalString(event.id) ?? `evt_${randomUUID()}`,
    scopeKey: migrationScopeKey(scope, event.scopeKey),
    threadId: optionalString(event.threadId) ?? optionalString(scope.threadId),
    operationId: optionalString(event.operationId) ?? optionalString(scope.operationId),
    role,
    content: requiredString(event.content, "Migration event content"),
    metadata: normalizeMetadata(event.metadata),
    createdAt: isoDate(event.createdAt, "Migration event createdAt")
  }
}

function normalizeMemory(scope: MemoryMigrationInput, item: MemoryMigrationItem | undefined): MemoryRecord {
  if (!item) throw new Error("Migration memory is missing.")

  const type = optionalString(item.type) ?? "fact"
  const content = requiredString(item.content, "Migration memory content")
  const sensitivity = item.sensitivity ?? "normal"
  const status = item.status ?? "active"

  if (!allowedSensitivity.has(sensitivity)) {
    throw new Error(`Migration memory sensitivity is unsupported: ${sensitivity}`)
  }

  if (!allowedStatus.has(status)) {
    throw new Error(`Migration memory status is unsupported: ${status}`)
  }

  const createdAt = isoDate(item.createdAt, "Migration memory createdAt")

  return {
    id: optionalString(item.id) ?? `mem_${randomUUID()}`,
    scopeKey: migrationScopeKey(scope, item.scopeKey),
    type,
    content,
    canonicalKey: optionalString(item.canonicalKey) ?? canonicalKeyFor(type, content),
    confidence: score(item.confidence, DEFAULT_CONFIDENCE, "Migration memory confidence"),
    importance: score(item.importance, DEFAULT_IMPORTANCE, "Migration memory importance"),
    sensitivity,
    status,
    sourceEventIds: uniqueStrings(item.sourceEventIds),
    createdAt,
    updatedAt: isoDate(item.updatedAt, "Migration memory updatedAt", createdAt)
  }
}

function syntheticSourceEvent(scope: MemoryMigrationInput, memory: MemoryRecord): MemoryEvent {
  return {
    id: `evt_${randomUUID()}`,
    scopeKey: memory.scopeKey,
    threadId: optionalString(scope.threadId),
    operationId: optionalString(scope.operationId),
    role: "user",
    content: memory.content,
    metadata: {
      kind: "migration",
      memoryId: memory.id,
      memoryType: memory.type
    },
    createdAt: memory.createdAt
  }
}

async function hasExistingEvent(store: MemoryStore, event: MemoryEvent): Promise<boolean> {
  const existing = await store.listRecentEvents({
    scopeKeys: [event.scopeKey],
    limit: EXISTING_LOOKUP_LIMIT
  })
  return existing.some((item) => item.id === event.id)
}

async function findExistingMemory(store: MemoryStore, memory: MemoryRecord): Promise<MemoryRecord | undefined> {
  const existing = await store.listMemories({
    scopeKeys: [memory.scopeKey],
    limit: EXISTING_LOOKUP_LIMIT
  })
  return existing.find((item) => {
    return item.id === memory.id ||
      (Boolean(item.canonicalKey) && item.canonicalKey === memory.canonicalKey)
  })
}

function migrationScopeKey(scope: MemoryMigrationInput, explicitScopeKey?: string): string {
  const explicit = optionalString(explicitScopeKey)
  if (explicit) return explicit

  const userId = optionalString(scope.userId)
  if (userId) return `user:${userId}`

  const orgId = optionalString(scope.orgId)
  if (orgId) return `org:${orgId}`

  const threadId = optionalString(scope.threadId)
  if (threadId) return `thread:${threadId}`

  return "default"
}

function normalizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (metadata === undefined) return {}
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Migration event metadata must be an object.")
  }
  return { ...metadata }
}

function requiredString(value: string, label: string): string {
  const normalized = optionalString(value)
  if (!normalized) throw new Error(`${label} must be a non-empty string.`)
  return normalized
}

function optionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(optionalString).filter((value): value is string => Boolean(value)))]
}

function score(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1.`)
  }
  return value
}

function isoDate(value: string | undefined, label: string, fallback = new Date().toISOString()): string {
  if (value === undefined) return fallback
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a valid date string.`)
  }
  return new Date(timestamp).toISOString()
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
