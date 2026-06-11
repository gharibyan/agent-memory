import { randomUUID } from "node:crypto"
import type {
  EventQuery,
  MemoryEmbedding,
  MemoryEvent,
  MemoryExport,
  MemoryListQuery,
  MemoryRecord,
  MemorySearchQuery,
  MemorySource,
  MemoryStore,
  MemoryStoreSnapshot,
  VectorQuery,
  VectorResult
} from "./types.js"

export function createMemoryStore(seed: Partial<MemoryStoreSnapshot> = {}): MemoryStore {
  const state: MemoryStoreSnapshot = {
    events: [...(seed.events ?? [])],
    memories: [...(seed.memories ?? [])],
    sources: [...(seed.sources ?? [])],
    embeddings: [...(seed.embeddings ?? [])]
  }

  const store: MemoryStore = {
    kind: "memory",

    async writeEvent(event: MemoryEvent): Promise<void> {
      state.events.push({ ...event })
    },

    async listRecentEvents(query: EventQuery = {}): Promise<MemoryEvent[]> {
      const scopeKeys = new Set(query.scopeKeys ?? [])
      const excludeEventIds = new Set(query.excludeEventIds ?? [])
      return state.events
        .filter((event) => scopeKeys.size === 0 || scopeKeys.has(event.scopeKey))
        .filter((event) => !excludeEventIds.has(event.id))
        .filter((event) => query.threadId === undefined || event.threadId === query.threadId)
        .filter((event) => query.operationId === undefined || event.operationId === query.operationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, query.limit ?? 20)
    },

    async upsertMemory(record: MemoryRecord): Promise<MemoryRecord> {
      const existingIndex = state.memories.findIndex((memory) => {
        return memory.id === record.id ||
          (memory.scopeKey === record.scopeKey &&
            Boolean(memory.canonicalKey) &&
            memory.canonicalKey === record.canonicalKey)
      })

      if (existingIndex >= 0) {
        const existing = state.memories[existingIndex] as MemoryRecord
        state.memories[existingIndex] = {
          ...existing,
          ...record,
          id: existing.id,
          updatedAt: new Date().toISOString()
        }
        return state.memories[existingIndex] as MemoryRecord
      }

      const memory = {
        ...record,
        id: record.id ?? `mem_${randomUUID()}`
      }
      state.memories.push(memory)
      return memory
    },

    async listMemories(query: MemoryListQuery = {}): Promise<MemoryRecord[]> {
      const scopeKeys = new Set(query.scopeKeys ?? [])
      return state.memories
        .filter((memory) => memory.status === "active")
        .filter((memory) => scopeKeys.size === 0 || scopeKeys.has(memory.scopeKey))
        .sort((a, b) => {
          return (b.importance ?? 0) - (a.importance ?? 0) ||
            b.updatedAt.localeCompare(a.updatedAt)
        })
        .slice(0, query.limit ?? 100)
    },

    async searchMemories(query: MemorySearchQuery = {}): Promise<MemoryRecord[]> {
      return store.listMemories(query)
    },

    async linkSource(source: MemorySource): Promise<void> {
      state.sources.push({ ...source })
    },

    async upsertEmbedding(embedding: MemoryEmbedding): Promise<void> {
      const existingIndex = state.embeddings.findIndex((item) => {
        return item.ownerType === embedding.ownerType && item.ownerId === embedding.ownerId
      })

      if (existingIndex >= 0) {
        state.embeddings[existingIndex] = { ...state.embeddings[existingIndex], ...embedding }
        return
      }

      state.embeddings.push({ ...embedding })
    },

    async searchEmbeddings(query: VectorQuery): Promise<VectorResult[]> {
      const scopeKeys = new Set(query.scopeKeys ?? [])
      const memoriesById = new Map(state.memories.map((memory) => [memory.id, memory]))

      return state.embeddings
        .map((embedding): VectorResult | null => {
          const memory = memoriesById.get(embedding.ownerId)
          if (!memory || memory.status !== "active") return null
          if (scopeKeys.size > 0 && !scopeKeys.has(memory.scopeKey)) return null

          return {
            ownerType: embedding.ownerType,
            ownerId: embedding.ownerId,
            score: cosineSimilarity(query.vector, embedding.vector)
          }
        })
        .filter((result): result is VectorResult => Boolean(result))
        .sort((a, b) => b.score - a.score)
        .slice(0, query.limit ?? 20)
    },

    async deleteMemory(memoryId: string): Promise<void> {
      const memory = state.memories.find((item) => item.id === memoryId)
      if (memory) {
        memory.status = "deleted"
        memory.updatedAt = new Date().toISOString()
      }
    },

    async forget(query: MemoryListQuery = {}): Promise<void> {
      const scopeKeys = new Set(query.scopeKeys ?? [])
      state.memories = state.memories.filter((memory) => !scopeKeys.has(memory.scopeKey))
      state.events = state.events.filter((event) => !scopeKeys.has(event.scopeKey))
      state.sources = state.sources.filter((source) => {
        return state.memories.some((memory) => memory.id === source.memoryId)
      })
      state.embeddings = state.embeddings.filter((embedding) => {
        return state.memories.some((memory) => memory.id === embedding.ownerId)
      })
    },

    async export(query: MemoryListQuery & { eventLimit?: number } = {}): Promise<MemoryExport> {
      const memories = await store.listMemories(query)
      const events = await store.listRecentEvents({ ...query, limit: query.eventLimit ?? 1000 })
      return { memories, events }
    },

    snapshot(): MemoryStoreSnapshot {
      return JSON.parse(JSON.stringify(state)) as MemoryStoreSnapshot
    }
  }

  return store
}

export function makeEvent(input: {
  scopeKey: string
  threadId?: string
  operationId?: string
  role: MemoryEvent["role"]
  content: string
  metadata?: Record<string, unknown>
}): MemoryEvent {
  return {
    id: `evt_${randomUUID()}`,
    scopeKey: input.scopeKey,
    threadId: input.threadId,
    operationId: input.operationId,
    role: input.role,
    content: input.content,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString()
  }
}

export function makeEmbedding(text: string, dimensions = 32): number[] {
  const vector = Array.from({ length: dimensions }, () => 0)
  const tokens = tokenize(text)

  for (const token of tokens) {
    let hash = 0
    for (let i = 0; i < token.length; i += 1) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0
    }
    const index = Math.abs(hash) % dimensions
    vector[index] = (vector[index] ?? 0) + 1
  }

  const length = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0)) || 1
  return vector.map((value) => value / length)
}

export function tokenize(text: string): string[] {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function cosineSimilarity(a: number[] = [], b: number[] = []): number {
  let dot = 0
  let aLength = 0
  let bLength = 0
  const length = Math.max(a.length, b.length)

  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    dot += av * bv
    aLength += av * av
    bLength += bv * bv
  }

  if (aLength === 0 || bLength === 0) return 0
  return dot / (Math.sqrt(aLength) * Math.sqrt(bLength))
}
