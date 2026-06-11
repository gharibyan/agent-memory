import { randomUUID } from "node:crypto"
import { createDefaultCompiler, canonicalKeyFor, validateMemoryPatch } from "./compiler.js"
import { createMemoryStore, makeEmbedding, makeEvent } from "./memory-store.js"
import { retrieveMemoryContext } from "./retrieval.js"
import { resolveScope, targetScopeKeys } from "./scopes.js"
import type {
  Agent,
  AgentConfig,
  AgentStream,
  CompilerProvider,
  GenerateInput,
  GenerateResult,
  MemoryPatch,
  MemoryRecord,
  MemoryScopeInput,
  MemoryStore,
  ModelProvider,
  ModelResponse,
  ModelStreamChunk,
  ResolvedMemoryScope
} from "./types.js"

export function createAgent(config: AgentConfig): Agent {
  if (!config.model) {
    throw new Error("createAgent() requires a model")
  }

  const store = normalizeStore(config.memory)
  const compiler = config.compiler ?? createDefaultCompiler()

  return {
    async generate(input: GenerateInput): Promise<GenerateResult> {
      if (!config.model.generate) {
        throw new Error("Configured model does not support generate().")
      }

      const scope = resolveScope(input)
      const memoryEnabled = input.memory?.enabled !== false && Boolean(store)
      const recallEnabled = input.memory?.recall !== false
      const learnEnabled = input.memory?.learn !== false

      const inputEvent = memoryEnabled && store
        ? makeEvent({
            scopeKey: scope.primaryKey,
            threadId: input.threadId,
            operationId: input.operationId,
            role: "user",
            content: userContent(input.messages),
            metadata: { kind: "generate-input" }
          })
        : null

      if (inputEvent && store) {
        await store.writeEvent(inputEvent)
      }

      const retrieved = memoryEnabled && recallEnabled && store
        ? await retrieveMemoryContext({
            store,
            scope,
            threadId: input.threadId,
            operationId: input.operationId,
            excludeEventIds: inputEvent ? [inputEvent.id] : [],
            messages: input.messages,
            contextBudget: input.memory?.contextBudget ?? configMemoryBudget(config.memory) ?? 1200
          })
        : { contextMessage: null, used: [] as MemoryRecord[] }

      const modelMessages = retrieved.contextMessage
        ? [retrieved.contextMessage, ...input.messages]
        : input.messages

      const response = await config.model.generate({
        messages: modelMessages,
        system: input.system,
        tools: input.tools,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        metadata: {
          userId: input.userId,
          orgId: input.orgId,
          threadId: input.threadId,
          operationId: input.operationId
        }
      })

      const assistantEvent = memoryEnabled && store
        ? makeEvent({
            scopeKey: scope.primaryKey,
            threadId: input.threadId,
            operationId: input.operationId,
            role: "assistant",
            content: response.text,
            metadata: { kind: "generate-output" }
          })
        : null

      if (assistantEvent && store) {
        await store.writeEvent(assistantEvent)
      }

      const learned = memoryEnabled && learnEnabled && store && inputEvent
        ? await learnFromInteraction({
            store,
            compiler,
            scope,
            input,
            response,
            inputEventId: inputEvent.id
          })
        : { created: [], ignored: [] }

      return {
        text: response.text,
        usage: response.usage,
        finishReason: response.finishReason,
        raw: response.raw,
        memory: input.debug
          ? {
              used: retrieved.used,
              created: learned.created,
              ignored: learned.ignored
            }
          : undefined
      }
    },

    async stream(input: GenerateInput): Promise<AgentStream> {
      const scope = resolveScope(input)
      const memoryEnabled = input.memory?.enabled !== false && Boolean(store)
      const recallEnabled = input.memory?.recall !== false
      const learnEnabled = input.memory?.learn !== false

      const inputEvent = memoryEnabled && store
        ? makeEvent({
            scopeKey: scope.primaryKey,
            threadId: input.threadId,
            operationId: input.operationId,
            role: "user",
            content: userContent(input.messages),
            metadata: { kind: "stream-input" }
          })
        : null

      if (inputEvent && store) {
        await store.writeEvent(inputEvent)
      }

      const retrieved = memoryEnabled && recallEnabled && store
        ? await retrieveMemoryContext({
            store,
            scope,
            threadId: input.threadId,
            operationId: input.operationId,
            excludeEventIds: inputEvent ? [inputEvent.id] : [],
            messages: input.messages,
            contextBudget: input.memory?.contextBudget ?? configMemoryBudget(config.memory) ?? 1200
          })
        : { contextMessage: null, used: [] as MemoryRecord[] }

      const modelMessages = retrieved.contextMessage
        ? [retrieved.contextMessage, ...input.messages]
        : input.messages

      const source = config.model.stream
        ? await config.model.stream({
            messages: modelMessages,
            system: input.system,
            tools: input.tools,
            temperature: input.temperature,
            maxTokens: input.maxTokens,
            metadata: {
              userId: input.userId,
              orgId: input.orgId,
              threadId: input.threadId,
              operationId: input.operationId
            }
          })
        : fallbackStream(await generateForStream(config.model, modelMessages))

      return createAgentStream({
        source,
        commit: async (text) => {
          if (!memoryEnabled || !store) return

          await store.writeEvent(makeEvent({
            scopeKey: scope.primaryKey,
            threadId: input.threadId,
            operationId: input.operationId,
            role: "assistant",
            content: text,
            metadata: { kind: "stream-output" }
          }))

          if (learnEnabled && inputEvent) {
            await learnFromInteraction({
              store,
              compiler,
              scope,
              input,
              response: { text },
              inputEventId: inputEvent.id
            })
          }
        }
      })
    },

    memory: {
      async list(query: MemoryScopeInput & { limit?: number } = {}) {
        ensureStore(store)
        return store.listMemories({ scopeKeys: targetScopeKeys(query), limit: query.limit })
      },

      async search(query: MemoryScopeInput & { query?: string; limit?: number } = {}) {
        ensureStore(store)
        return store.searchMemories({
          scopeKeys: targetScopeKeys(query),
          query: query.query,
          limit: query.limit
        })
      },

      async delete(memoryId: string) {
        ensureStore(store)
        return store.deleteMemory(memoryId)
      },

      async forget(query: MemoryScopeInput = {}) {
        ensureStore(store)
        return store.forget({ scopeKeys: targetScopeKeys(query) })
      },

      async export(query: MemoryScopeInput = {}) {
        ensureStore(store)
        return store.export({ scopeKeys: targetScopeKeys(query) })
      }
    }
  }
}

async function learnFromInteraction(input: {
  store: MemoryStore
  compiler: CompilerProvider
  scope: ResolvedMemoryScope
  input: GenerateInput
  response: ModelResponse
  inputEventId: string
}): Promise<{ created: MemoryRecord[]; ignored: Array<{ reason: string; patch?: MemoryPatch }> }> {
  const output = await input.compiler.compile({
    scope: input.scope,
    currentMessages: input.input.messages,
    assistantResponse: input.response,
    inputEventId: input.inputEventId
  })

  const created: MemoryRecord[] = []
  const ignored: Array<{ reason: string; patch?: MemoryPatch }> = []

  for (const patch of output.patches ?? []) {
    const validation = validateMemoryPatch(patch)
    if (!validation.accepted) {
      ignored.push({ reason: validation.reason, patch })
      continue
    }

    if (patch.op !== "create") continue

    const now = new Date().toISOString()
    const memory = await input.store.upsertMemory({
      id: `mem_${randomUUID()}`,
      scopeKey: input.scope.primaryKey,
      type: patch.type,
      content: patch.content,
      canonicalKey: canonicalKeyFor(patch.type, patch.content),
      confidence: patch.confidence,
      importance: patch.importance,
      sensitivity: patch.sensitivity,
      status: "active",
      sourceEventIds: patch.evidence.map((item) => item.eventId),
      createdAt: now,
      updatedAt: now
    })

    for (const evidence of patch.evidence) {
      await input.store.linkSource({
        memoryId: memory.id,
        eventId: evidence.eventId,
        quote: evidence.quote,
        reason: evidence.reason
      })
    }

    await input.store.upsertEmbedding({
      ownerType: "memory",
      ownerId: memory.id,
      model: "local-hash-v1",
      dimensions: 32,
      vector: makeEmbedding(memory.content),
      createdAt: now
    })

    created.push(memory)
  }

  return { created, ignored }
}

function normalizeStore(memory: AgentConfig["memory"]): MemoryStore | null {
  if (memory === false) return null
  if (!memory || memory === "auto") return createMemoryStore()
  if ("writeEvent" in memory && typeof memory.writeEvent === "function") return memory
  if ("store" in memory && memory.store) return memory.store
  return memory as MemoryStore
}

function configMemoryBudget(memory: AgentConfig["memory"]): number | undefined {
  if (!memory || memory === "auto") return undefined
  if ("contextBudget" in memory && typeof memory.contextBudget === "number") return memory.contextBudget
  return undefined
}

function ensureStore(store: MemoryStore | null): asserts store is MemoryStore {
  if (!store) {
    throw new Error("Memory is disabled for this agent.")
  }
}

function userContent(messages: GenerateInput["messages"] = []): string {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")
}

async function generateForStream(model: ModelProvider, messages: GenerateInput["messages"]): Promise<ModelResponse> {
  if (!model.generate) {
    throw new Error("Configured model does not support stream() or generate().")
  }
  return model.generate({ messages })
}

async function* fallbackStream(response: ModelResponse): AsyncIterable<ModelStreamChunk> {
  yield response.text
}

function createAgentStream(input: {
  source: AsyncIterable<ModelStreamChunk>
  commit(text: string): Promise<void>
}): AgentStream {
  let consumed = false
  let committed = false

  const collect = async (): Promise<string> => {
    if (consumed) {
      throw new Error("This stream has already been consumed.")
    }

    consumed = true
    let text = ""

    for await (const chunk of input.source) {
      text += normalizeChunk(chunk)
    }

    if (!committed) {
      committed = true
      await input.commit(text)
    }

    return text
  }

  return {
    async text() {
      return collect()
    },

    async *[Symbol.asyncIterator]() {
      if (consumed) {
        throw new Error("This stream has already been consumed.")
      }

      consumed = true
      let text = ""

      for await (const chunk of input.source) {
        const normalized = normalizeChunk(chunk)
        text += normalized
        yield normalized
      }

      if (!committed) {
        committed = true
        await input.commit(text)
      }
    },

    toResponse() {
      const iterator = this[Symbol.asyncIterator]()
      const encoder = new TextEncoder()

      return new Response(new ReadableStream({
        async pull(controller) {
          const next = await iterator.next()
          if (next.done) {
            controller.close()
            return
          }
          controller.enqueue(encoder.encode(next.value))
        }
      }))
    }
  }
}

function normalizeChunk(chunk: ModelStreamChunk): string {
  if (typeof chunk === "string") return chunk
  if (typeof chunk?.text === "string") return chunk.text
  if (typeof chunk?.content === "string") return chunk.content
  return ""
}
