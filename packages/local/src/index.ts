import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { createMemoryStore } from "@agent-memory/core"
import type {
  EventQuery,
  MemoryEmbedding,
  MemoryEvent,
  MemoryListQuery,
  MemoryRecord,
  MemorySearchQuery,
  MemorySource,
  MemoryStore,
  MemoryStoreSnapshot,
  VectorQuery
} from "@agent-memory/core"

export function localMemory(options: { path?: string } = {}): MemoryStore {
  const path = resolve(options.path ?? ".memory/memory.json")
  let loadedStore: MemoryStore | undefined

  async function store(): Promise<MemoryStore> {
    if (loadedStore) return loadedStore

    const seed = await readState(path)
    const inner = createMemoryStore(seed)
    loadedStore = persistOnWrite(inner, path)
    return loadedStore
  }

  return {
    kind: "local-file",
    async writeEvent(event: MemoryEvent) {
      return (await store()).writeEvent(event)
    },
    async listRecentEvents(query?: EventQuery) {
      return (await store()).listRecentEvents(query)
    },
    async upsertMemory(record: MemoryRecord) {
      return (await store()).upsertMemory(record)
    },
    async listMemories(query?: MemoryListQuery) {
      return (await store()).listMemories(query)
    },
    async searchMemories(query?: MemorySearchQuery) {
      return (await store()).searchMemories(query)
    },
    async linkSource(source: MemorySource) {
      return (await store()).linkSource(source)
    },
    async upsertEmbedding(embedding: MemoryEmbedding) {
      return (await store()).upsertEmbedding(embedding)
    },
    async searchEmbeddings(query: VectorQuery) {
      return (await store()).searchEmbeddings?.(query) ?? []
    },
    async deleteMemory(memoryId: string) {
      return (await store()).deleteMemory(memoryId)
    },
    async forget(query?: MemoryListQuery) {
      return (await store()).forget(query)
    },
    async export(query?: MemoryListQuery & { eventLimit?: number }) {
      return (await store()).export(query)
    },
    snapshot() {
      if (!loadedStore?.snapshot) {
        return { events: [], memories: [], sources: [], embeddings: [] }
      }
      return loadedStore.snapshot()
    }
  }
}

async function readState(path: string): Promise<Partial<MemoryStoreSnapshot>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Partial<MemoryStoreSnapshot>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw error
  }
}

function persistOnWrite(store: MemoryStore, path: string): MemoryStore {
  const persist = async () => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(store.snapshot?.() ?? {}, null, 2))
  }

  return {
    ...store,
    async writeEvent(event: MemoryEvent) {
      const result = await store.writeEvent(event)
      await persist()
      return result
    },
    async upsertMemory(record: MemoryRecord) {
      const result = await store.upsertMemory(record)
      await persist()
      return result
    },
    async linkSource(source: MemorySource) {
      const result = await store.linkSource(source)
      await persist()
      return result
    },
    async upsertEmbedding(embedding: MemoryEmbedding) {
      const result = await store.upsertEmbedding(embedding)
      await persist()
      return result
    },
    async deleteMemory(memoryId: string) {
      const result = await store.deleteMemory(memoryId)
      await persist()
      return result
    },
    async forget(query?: MemoryListQuery) {
      const result = await store.forget(query)
      await persist()
      return result
    }
  }
}
