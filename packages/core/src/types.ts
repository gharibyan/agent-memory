export type AgentRole = "system" | "user" | "assistant" | "tool"

export type AgentMessage = {
  role: AgentRole
  content: string
  toolCallId?: string
}

export type ModelRequest = {
  messages: AgentMessage[]
  system?: string
  tools?: unknown[]
  temperature?: number
  maxTokens?: number
  metadata?: Record<string, unknown>
}

export type ModelResponse = {
  text: string
  messages?: AgentMessage[]
  toolCalls?: unknown[]
  usage?: unknown
  finishReason?: string
  raw?: unknown
}

export type ModelProvider = {
  id: string
  capabilities: {
    streaming: boolean
    tools?: boolean
    jsonSchema?: boolean
    vision?: boolean
  }
  generate?: (request: ModelRequest) => Promise<ModelResponse>
  stream?: (request: ModelRequest) => AsyncIterable<ModelStreamChunk> | Promise<AsyncIterable<ModelStreamChunk>>
}

export type ModelStreamChunk = string | {
  text?: string
  content?: string
}

export type AgentMemoryConfig =
  | "auto"
  | false
  | MemoryStore
  | {
      store?: MemoryStore
      contextBudget?: number
    }

export type AgentConfig = {
  model: ModelProvider
  memory?: AgentMemoryConfig
  compiler?: CompilerProvider
}

export type MemoryScopeInput = {
  userId?: string
  orgId?: string
  threadId?: string
  operationId?: string
}

export type ResolvedMemoryScope = {
  primaryKey: string
  keys: string[]
  targetKeys: string[]
}

export type GenerateInput = MemoryScopeInput & {
  messages: AgentMessage[]
  debug?: boolean
  system?: string
  tools?: unknown[]
  temperature?: number
  maxTokens?: number
  memory?: {
    enabled?: boolean
    recall?: boolean
    learn?: boolean
    contextBudget?: number
  }
}

export type GenerateResult = {
  text: string
  usage?: unknown
  finishReason?: string
  raw?: unknown
  memory?: MemoryDebugInfo
}

export type MemoryDebugInfo = {
  used: MemoryRecord[]
  created: MemoryRecord[]
  ignored: IgnoredMemoryPatch[]
}

export type IgnoredMemoryPatch = {
  reason: string
  patch?: MemoryPatch
}

export type AgentStream = AsyncIterable<string> & {
  text(): Promise<string>
  toResponse(): Response
}

export type Agent = {
  generate(input: GenerateInput): Promise<GenerateResult>
  stream(input: GenerateInput): Promise<AgentStream>
  memory: {
    list(query?: MemoryListQuery): Promise<MemoryRecord[]>
    search(query?: MemorySearchQuery): Promise<MemoryRecord[]>
    migrate(input: MemoryMigrationInput): Promise<MemoryMigrationResult>
    delete(memoryId: string): Promise<void>
    forget(query?: MemoryScopeInput): Promise<void>
    export(query?: MemoryScopeInput): Promise<MemoryExport>
  }
}

export type MemoryEvent = {
  id: string
  scopeKey: string
  threadId?: string
  operationId?: string
  role: AgentRole
  content: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type MemoryRecord = {
  id: string
  scopeKey: string
  type: MemoryRecordType
  content: string
  canonicalKey?: string
  confidence: number
  importance: number
  sensitivity: "normal" | "sensitive" | "secret"
  status: "active" | "superseded" | "deleted"
  sourceEventIds: string[]
  createdAt: string
  updatedAt: string
}

export type MemoryRecordType = "preference" | "fact" | "constraint" | "decision" | "goal" | "summary" | string

export type MemorySource = {
  memoryId: string
  eventId: string
  quote?: string
  reason: string
}

export type MemoryEmbedding = {
  ownerType: "memory" | string
  ownerId: string
  model: string
  dimensions: number
  vector: number[]
  createdAt: string
}

export type MemoryListQuery = MemoryScopeInput & {
  scopeKeys?: string[]
  limit?: number
}

export type MemorySearchQuery = MemoryListQuery & {
  query?: string
}

export type EventQuery = {
  scopeKeys?: string[]
  threadId?: string
  operationId?: string
  excludeEventIds?: string[]
  limit?: number
}

export type VectorQuery = {
  scopeKeys?: string[]
  vector: number[]
  limit?: number
}

export type VectorResult = {
  ownerType: string
  ownerId: string
  score: number
}

export type MemoryExport = {
  memories: MemoryRecord[]
  events: MemoryEvent[]
}

export type MemoryMigrationMode = "upsert" | "skipExisting"

export type MemoryMigrationInput = MemoryScopeInput & {
  data?: MemoryMigrationItem[]
  memories?: MemoryMigrationItem[]
  events?: MemoryMigrationEvent[]
  mode?: MemoryMigrationMode
}

export type MemoryMigrationItem = {
  id?: string
  scopeKey?: string
  type?: MemoryRecordType
  content: string
  canonicalKey?: string
  confidence?: number
  importance?: number
  sensitivity?: MemoryRecord["sensitivity"]
  status?: MemoryRecord["status"]
  sourceEventIds?: string[]
  createdAt?: string
  updatedAt?: string
}

export type MemoryMigrationEvent = {
  id?: string
  scopeKey?: string
  threadId?: string
  operationId?: string
  role?: AgentRole
  content: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export type MemoryMigrationFailure = {
  target: "memory" | "event"
  index: number
  reason: string
}

export type MemoryMigrationResult = {
  memories: {
    created: number
    updated: number
    skipped: number
    failed: number
  }
  events: {
    imported: number
    skipped: number
    failed: number
  }
  failures: MemoryMigrationFailure[]
}

export type MemoryStore = {
  kind?: string
  writeEvent(event: MemoryEvent): Promise<void>
  listRecentEvents(query?: EventQuery): Promise<MemoryEvent[]>
  upsertMemory(record: MemoryRecord): Promise<MemoryRecord>
  listMemories(query?: MemoryListQuery): Promise<MemoryRecord[]>
  searchMemories(query?: MemorySearchQuery): Promise<MemoryRecord[]>
  linkSource(source: MemorySource): Promise<void>
  upsertEmbedding(embedding: MemoryEmbedding): Promise<void>
  searchEmbeddings?(query: VectorQuery): Promise<VectorResult[]>
  deleteMemory(memoryId: string): Promise<void>
  forget(query?: MemoryListQuery): Promise<void>
  export(query?: MemoryListQuery & { eventLimit?: number }): Promise<MemoryExport>
  snapshot?(): MemoryStoreSnapshot
}

export type MemoryStoreSnapshot = {
  events: MemoryEvent[]
  memories: MemoryRecord[]
  sources: MemorySource[]
  embeddings: MemoryEmbedding[]
}

export type CandidateMemoryPatch = {
  op: "create"
  type: "preference" | "fact" | "constraint" | "decision" | "goal"
  content: string
  confidence: number
  importance: number
  sensitivity: "normal" | "sensitive" | "secret"
  ttl?: string
  evidence: Evidence[]
}

export type MemoryPatch =
  | CandidateMemoryPatch
  | { op: "update" | "supersede" | "delete"; [key: string]: unknown }
  | { op: "noop"; reason: string }

export type Evidence = {
  eventId: string
  quote?: string
  reason: string
}

export type CompilerInput = {
  scope: ResolvedMemoryScope
  currentMessages: AgentMessage[]
  assistantResponse: ModelResponse
  inputEventId: string
}

export type CompilerOutput = {
  patches: MemoryPatch[]
}

export type CompilerProvider = {
  id: string
  compile(input: CompilerInput): Promise<CompilerOutput>
}

export type ValidationResult =
  | { accepted: true }
  | { accepted: false; reason: string }
