import { makeEmbedding, tokenize } from "./memory-store.js"
import type { AgentMessage, MemoryEvent, MemoryRecord, MemoryStore, ResolvedMemoryScope } from "./types.js"

export async function retrieveMemoryContext(input: {
  store: MemoryStore
  scope: ResolvedMemoryScope
  threadId?: string
  operationId?: string
  excludeEventIds?: string[]
  messages: AgentMessage[]
  contextBudget?: number
}): Promise<{ contextMessage: AgentMessage | null; used: MemoryRecord[] }> {
  const contextBudget = input.contextBudget ?? 1200
  const query = input.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")

  const records = await input.store.searchMemories({
    scopeKeys: input.scope.keys,
    query,
    limit: 50
  })

  const queryVector = makeEmbedding(query)
  const vectorResults = typeof input.store.searchEmbeddings === "function"
    ? await input.store.searchEmbeddings({ scopeKeys: input.scope.keys, vector: queryVector, limit: 50 })
    : []
  const vectorScores = new Map(vectorResults.map((result) => [result.ownerId, result.score]))

  const scored = records
    .map((memory) => ({
      memory,
      score: scoreMemory(memory, {
        query,
        vectorScore: vectorScores.get(memory.id) ?? 0,
        scope: input.scope
      })
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  const recentEvents = input.threadId || input.operationId
    ? (await input.store.listRecentEvents({
        scopeKeys: input.scope.keys,
        threadId: input.threadId,
        operationId: input.operationId,
        excludeEventIds: input.excludeEventIds,
        limit: 8
      })).reverse()
    : []

  const packed = packContext({
    memories: scored.map((item) => item.memory),
    events: recentEvents,
    contextBudget,
    operationScoped: Boolean(input.operationId)
  })

  if (!packed.content) {
    return { contextMessage: null, used: [] }
  }

  return {
    used: packed.usedMemories,
    contextMessage: {
      role: "system",
      content: packed.content
    }
  }
}

function scoreMemory(
  memory: MemoryRecord,
  input: { query: string; vectorScore: number; scope: ResolvedMemoryScope }
): number {
  const queryTokens = new Set(tokenize(input.query))
  const memoryTokens = new Set(tokenize(memory.content))
  let overlap = 0

  for (const token of queryTokens) {
    if (memoryTokens.has(token)) overlap += 1
  }

  const lexical = queryTokens.size > 0 ? overlap / queryTokens.size : 0
  const scopePriority = input.scope.keys.indexOf(memory.scopeKey)
  const scopeScore = scopePriority >= 0 ? 1 - (scopePriority * 0.1) : 0
  const typeBoost = memory.type === "preference" || memory.type === "constraint" ? 0.4 : 0

  return (input.vectorScore * 0.35) +
    (lexical * 0.25) +
    ((memory.importance ?? 0) * 0.2) +
    (scopeScore * 0.1) +
    ((memory.confidence ?? 0) * 0.1) +
    typeBoost
}

function memoryLine(memory: MemoryRecord): string {
  return `- ${labelFor(memory.type)}: ${memory.content}\n`
}

function eventLine(event: MemoryEvent): string {
  return `- ${labelFor(event.role)}: ${event.content}`
}

function packContext(input: {
  memories: MemoryRecord[]
  events: MemoryEvent[]
  contextBudget: number
  operationScoped: boolean
}): { content: string | null; usedMemories: MemoryRecord[] } {
  const lines: string[] = []
  const usedMemories: MemoryRecord[] = []
  const budget = Math.max(0, input.contextBudget)

  function tryPush(line: string): boolean {
    const next = [...lines, line].join("\n")
    if (next.length <= budget) {
      lines.push(line)
      return true
    }
    return false
  }

  if (input.memories.length > 0 && tryPush("Relevant memory:")) {
    for (const memory of input.memories) {
      const pushed = tryPush(memoryLine(memory).trimEnd())
      if (pushed) usedMemories.push(memory)
    }
  }

  const eventHeader = input.operationScoped ? "Recent operation context:" : "Recent thread context:"
  if (input.events.length > 0) {
    if (lines.length > 0) tryPush("")
    if (tryPush(eventHeader)) {
      for (const event of input.events) {
        const line = eventLine(event)
        if (tryPush(line)) continue

        const remaining = budget - [...lines, ""].join("\n").length
        if (remaining <= 24) continue
        tryPush(truncateLine(line, remaining))
      }
    }
  }

  return {
    content: lines.length > 0 ? lines.join("\n") : null,
    usedMemories
  }
}

function truncateLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line
  if (maxLength <= 3) return line.slice(0, maxLength)
  return `${line.slice(0, maxLength - 3)}...`
}

function labelFor(type: string): string {
  return type[0]?.toUpperCase() + type.slice(1)
}
