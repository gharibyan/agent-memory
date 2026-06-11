import Anthropic from "@anthropic-ai/sdk"
import { customModel } from "@agent-memory/core"
import type { AgentMessage, ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk } from "@agent-memory/core"

export type AnthropicClient = {
  messages: {
    create(input: AnthropicMessageInput): Promise<AnthropicMessageResponse | AsyncIterable<AnthropicStreamEvent>>
  }
}

export type AnthropicOptions = {
  id?: string
  model: string
  apiKey?: string
  headers?: Record<string, string>
  client?: AnthropicClient
  maxTokens?: number
}

export function anthropic(
  modelOrOptions: string | AnthropicOptions,
  options: Partial<AnthropicOptions> = {}
): ModelProvider {
  const config = typeof modelOrOptions === "string"
    ? { model: modelOrOptions, ...options }
    : modelOrOptions

  if (!config.model) {
    throw new Error("anthropic provider requires a model")
  }

  let client: AnthropicClient | undefined = config.client

  function sdk(): AnthropicClient {
    if (!client) {
      client = new Anthropic({
        apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
        defaultHeaders: config.headers
      }) as unknown as AnthropicClient
    }
    return client
  }

  return customModel({
    id: config.id ?? `anthropic:${config.model}`,
    capabilities: {
      streaming: true,
      tools: true,
      jsonSchema: false
    },
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const response = await sdk().messages.create(anthropicInput(config, request, false))
      const json = response as AnthropicMessageResponse
      const text = textFromAnthropicContent(json.content)

      return {
        text,
        messages: text ? [{ role: "assistant", content: text }] : undefined,
        toolCalls: toolCallsFromAnthropicContent(json.content),
        usage: json.usage,
        finishReason: json.stop_reason,
        raw: json
      }
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      const stream = await sdk().messages.create(anthropicInput(config, request, true))

      for await (const event of stream as AsyncIterable<AnthropicStreamEvent>) {
        const text = textFromAnthropicStreamEvent(event)
        if (text.length > 0) yield text
      }
    }
  })
}

function anthropicInput(config: AnthropicOptions, request: ModelRequest, stream: boolean): AnthropicMessageInput {
  const system = systemInstruction(request)

  return {
    model: config.model,
    messages: request.messages.filter((message) => message.role !== "system").map(anthropicMessage),
    max_tokens: request.maxTokens ?? config.maxTokens ?? 1024,
    ...(system ? { system } : {}),
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    stream
  }
}

function systemInstruction(request: ModelRequest): string {
  return [
    request.system,
    ...request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n\n")
}

function anthropicMessage(message: AgentMessage): { role: "user" | "assistant"; content: string } {
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content
  }
}

function textFromAnthropicContent(content: AnthropicContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ""

  return content
    .map((block) => block.type === "text" && typeof block.text === "string" ? block.text : "")
    .join("")
}

function toolCallsFromAnthropicContent(content: AnthropicContentBlock[] | undefined): unknown[] | undefined {
  if (!Array.isArray(content)) return undefined
  const toolCalls = content.filter((block) => block.type === "tool_use")
  return toolCalls.length > 0 ? toolCalls : undefined
}

function textFromAnthropicStreamEvent(event: AnthropicStreamEvent): string {
  if (event.type !== "content_block_delta") return ""
  const delta = event.delta
  return delta?.type === "text_delta" && typeof delta.text === "string" ? delta.text : ""
}

type AnthropicMessageInput = {
  model: string
  messages: Array<{ role: "user" | "assistant"; content: string }>
  max_tokens: number
  system?: string
  tools?: unknown[]
  temperature?: number
  stream: boolean
}

type AnthropicMessageResponse = {
  content?: AnthropicContentBlock[]
  stop_reason?: string
  usage?: unknown
}

type AnthropicContentBlock = {
  type?: string
  text?: string
  [key: string]: unknown
}

type AnthropicStreamEvent = {
  type?: string
  delta?: {
    type?: string
    text?: string
  }
}
