import OpenAI from "openai"
import { customModel } from "@agent-memory/core"
import type { AgentMessage, ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk } from "@agent-memory/core"

export type OpenAIChatClient = {
  chat: {
    completions: {
      create(input: ChatCompletionInput): Promise<OpenAIChatCompletion | AsyncIterable<OpenAIChatCompletionChunk>>
    }
  }
}

export type OpenAICompatibleOptions = {
  id?: string
  model: string
  baseURL?: string
  apiKey?: string
  headers?: Record<string, string>
  client?: OpenAIChatClient
}

export function openai(
  modelOrOptions: string | OpenAICompatibleOptions,
  options: Partial<OpenAICompatibleOptions> = {}
): ModelProvider {
  const config = typeof modelOrOptions === "string"
    ? { model: modelOrOptions, ...options }
    : modelOrOptions

  return createOpenAIChatProvider({
    idPrefix: "openai",
    tokenParameter: "max_completion_tokens",
    apiKey: process.env.OPENAI_API_KEY,
    ...config
  })
}

export function openAICompatible(config: OpenAICompatibleOptions): ModelProvider {
  return createOpenAIChatProvider({
    idPrefix: "openai-compatible",
    tokenParameter: "max_tokens",
    ...config
  })
}

function createOpenAIChatProvider(
  config: OpenAICompatibleOptions & { idPrefix: string; tokenParameter: TokenParameter }
): ModelProvider {
  if (!config.model) {
    throw new Error(`${config.idPrefix} provider requires a model`)
  }

  let client: OpenAIChatClient | undefined = config.client

  function sdk(): OpenAIChatClient {
    if (!client) {
      client = new OpenAI({
        apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
        baseURL: config.baseURL,
        defaultHeaders: config.headers
      }) as unknown as OpenAIChatClient
    }
    return client
  }

  return customModel({
    id: config.id ?? `${config.idPrefix}:${config.model}`,
    capabilities: {
      streaming: true,
      tools: true,
      jsonSchema: true
    },
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const completion = await sdk().chat.completions.create(chatCompletionInput(config, request, false))
      const json = completion as OpenAIChatCompletion
      const choice = json.choices?.[0]
      return {
        text: textFromContent(choice?.message?.content),
        messages: choice?.message?.content ? [{ role: "assistant", content: textFromContent(choice.message.content) }] : undefined,
        toolCalls: choice?.message?.tool_calls,
        usage: json.usage,
        finishReason: choice?.finish_reason,
        raw: json
      }
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      const stream = await sdk().chat.completions.create(chatCompletionInput(config, request, true))

      for await (const chunk of stream as AsyncIterable<OpenAIChatCompletionChunk>) {
        const text = chunk.choices?.[0]?.delta?.content
        if (typeof text === "string" && text.length > 0) yield text
      }
    }
  })
}

function chatCompletionInput(
  config: OpenAICompatibleOptions & { tokenParameter: TokenParameter },
  request: ModelRequest,
  stream: boolean
): ChatCompletionInput {
  return {
    model: config.model,
    messages: request.messages.map(openAIMessage),
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...tokenLimit(config.tokenParameter, request.maxTokens),
    stream
  }
}

function tokenLimit(parameter: TokenParameter, maxTokens: number | undefined): Partial<ChatCompletionInput> {
  if (maxTokens === undefined) return {}
  return parameter === "max_completion_tokens"
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens }
}

function openAIMessage(message: AgentMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {})
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "")
      }
      return ""
    })
    .join("")
}

type OpenAIChatCompletion = {
  choices?: Array<{
    message?: {
      content?: unknown
      tool_calls?: unknown[]
    }
    finish_reason?: string
  }>
  usage?: unknown
}

type OpenAIChatCompletionChunk = {
  choices?: Array<{
    delta?: { content?: string }
  }>
}

type ChatCompletionInput = {
  model: string
  messages: Array<Record<string, unknown>>
  tools?: unknown[]
  temperature?: number
  max_tokens?: number
  max_completion_tokens?: number
  stream: boolean
}

type TokenParameter = "max_tokens" | "max_completion_tokens"
