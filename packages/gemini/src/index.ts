import { GoogleGenAI } from "@google/genai"
import { customModel } from "@agent-memory/core"
import type { AgentMessage, ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk } from "@agent-memory/core"

export type GeminiClient = {
  models: {
    generateContent(input: GeminiGenerateInput): Promise<GeminiGenerateResponse>
    generateContentStream(input: GeminiGenerateInput): Promise<AsyncIterable<GeminiGenerateResponse>>
  }
}

export type GeminiOptions = {
  id?: string
  model: string
  apiKey?: string
  client?: GeminiClient
}

export function gemini(
  modelOrOptions: string | GeminiOptions,
  options: Partial<GeminiOptions> = {}
): ModelProvider {
  const config = typeof modelOrOptions === "string"
    ? { model: modelOrOptions, ...options }
    : modelOrOptions

  if (!config.model) {
    throw new Error("gemini provider requires a model")
  }

  let client: GeminiClient | undefined = config.client

  function sdk(): GeminiClient {
    if (!client) {
      client = new GoogleGenAI({
        apiKey: config.apiKey ?? process.env.GEMINI_API_KEY
      }) as unknown as GeminiClient
    }
    return client
  }

  return customModel({
    id: config.id ?? `gemini:${config.model}`,
    capabilities: {
      streaming: true,
      tools: true,
      jsonSchema: true
    },
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const response = await sdk().models.generateContent(geminiInput(config.model, request))
      const text = textFromGeminiResponse(response)

      return {
        text,
        messages: text ? [{ role: "assistant", content: text }] : undefined,
        usage: response.usageMetadata,
        finishReason: response.candidates?.[0]?.finishReason,
        raw: response
      }
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      const stream = await sdk().models.generateContentStream(geminiInput(config.model, request))

      for await (const chunk of stream) {
        const text = textFromGeminiResponse(chunk)
        if (text.length > 0) yield text
      }
    }
  })
}

function geminiInput(model: string, request: ModelRequest): GeminiGenerateInput {
  const system = systemInstruction(request)
  const config = cleanConfig({
    ...(system ? { systemInstruction: system } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { maxOutputTokens: request.maxTokens }),
    ...(request.tools ? { tools: request.tools } : {})
  })

  return {
    model,
    contents: request.messages.filter((message) => message.role !== "system").map(geminiContent),
    ...(Object.keys(config).length > 0 ? { config } : {})
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

function geminiContent(message: AgentMessage): GeminiContent {
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }
}

function cleanConfig(config: GeminiConfig): GeminiConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  ) as GeminiConfig
}

function textFromGeminiResponse(response: GeminiGenerateResponse): string {
  if (typeof response.text === "string") return response.text

  return response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("") ?? ""
}

type GeminiGenerateInput = {
  model: string
  contents: GeminiContent[]
  config?: GeminiConfig
}

type GeminiContent = {
  role: "user" | "model"
  parts: Array<{ text: string }>
}

type GeminiConfig = {
  systemInstruction?: string
  temperature?: number
  maxOutputTokens?: number
  tools?: unknown[]
}

type GeminiGenerateResponse = {
  text?: string
  usageMetadata?: unknown
  candidates?: Array<{
    finishReason?: string
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}
