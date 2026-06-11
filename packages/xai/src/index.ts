import OpenAI from "openai"
import { customModel } from "@agent-memory/core"
import type { AgentMessage, ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk } from "@agent-memory/core"

const XAI_BASE_URL = "https://api.x.ai/v1"

export type XAIChatClient = {
  chat: {
    completions: {
      create(input: XAIChatCompletionInput): Promise<XAIChatCompletion | AsyncIterable<XAIChatCompletionChunk>>
    }
  }
}

export type XAIOptions = {
  id?: string
  model: string
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  client?: XAIChatClient
}

export function xai(
  modelOrOptions: string | XAIOptions,
  options: Partial<XAIOptions> = {}
): ModelProvider {
  const config = typeof modelOrOptions === "string"
    ? { model: modelOrOptions, ...options }
    : modelOrOptions

  if (!config.model) {
    throw new Error("xai provider requires a model")
  }

  let client: XAIChatClient | undefined = config.client

  function sdk(): XAIChatClient {
    if (!client) {
      client = new OpenAI({
        apiKey: config.apiKey ?? process.env.XAI_API_KEY,
        baseURL: config.baseURL ?? XAI_BASE_URL,
        defaultHeaders: config.headers
      }) as unknown as XAIChatClient
    }
    return client
  }

  return customModel({
    id: config.id ?? `xai:${config.model}`,
    capabilities: {
      streaming: true,
      tools: true,
      jsonSchema: true
    },
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const completion = await sdk().chat.completions.create(xaiChatCompletionInput(config.model, request, false))
      const json = completion as XAIChatCompletion
      const choice = json.choices?.[0]
      const text = textFromContent(choice?.message?.content)

      return {
        text,
        messages: text ? [{ role: "assistant", content: text }] : undefined,
        toolCalls: choice?.message?.tool_calls,
        usage: json.usage,
        finishReason: choice?.finish_reason,
        raw: json
      }
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      const stream = await sdk().chat.completions.create(xaiChatCompletionInput(config.model, request, true))

      for await (const chunk of stream as AsyncIterable<XAIChatCompletionChunk>) {
        const text = chunk.choices?.[0]?.delta?.content
        if (typeof text === "string" && text.length > 0) yield text
      }
    }
  })
}

function xaiChatCompletionInput(model: string, request: ModelRequest, stream: boolean): XAIChatCompletionInput {
  return {
    model,
    messages: request.messages.map(xaiMessage),
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    stream
  }
}

function xaiMessage(message: AgentMessage): Record<string, unknown> {
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

type XAIChatCompletion = {
  choices?: Array<{
    message?: {
      content?: unknown
      tool_calls?: unknown[]
    }
    finish_reason?: string
  }>
  usage?: unknown
}

type XAIChatCompletionChunk = {
  choices?: Array<{
    delta?: { content?: string }
  }>
}

type XAIChatCompletionInput = {
  model: string
  messages: Array<Record<string, unknown>>
  tools?: unknown[]
  temperature?: number
  max_tokens?: number
  stream: boolean
}
