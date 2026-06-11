import { customModel } from "@agent-memory/core"
import type { ModelProvider, ModelRequest, ModelResponse, ModelStreamChunk } from "@agent-memory/core"

export type OpenAICompatibleOptions = {
  id?: string
  model: string
  baseURL?: string
  apiKey?: string
  headers?: Record<string, string>
}

export function openai(
  modelOrOptions: string | OpenAICompatibleOptions,
  options: Partial<OpenAICompatibleOptions> = {}
): ModelProvider {
  const config = typeof modelOrOptions === "string"
    ? { model: modelOrOptions, ...options }
    : modelOrOptions

  return openAICompatible({
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
    ...config
  })
}

export function openAICompatible(config: OpenAICompatibleOptions): ModelProvider {
  if (!config.model) {
    throw new Error("openAICompatible() requires a model")
  }

  const baseURL = (config.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "")

  return customModel({
    id: config.id ?? `openai-compatible:${config.model}`,
    capabilities: {
      streaming: true,
      tools: true,
      jsonSchema: true
    },
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
          ...config.headers
        },
        body: JSON.stringify({
          model: config.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: false
        })
      })

      if (!response.ok) {
        throw new Error(`Model request failed with ${response.status}: ${await response.text()}`)
      }

      const json = await response.json() as OpenAICompatibleResponse
      return {
        text: json.choices?.[0]?.message?.content ?? "",
        usage: json.usage,
        finishReason: json.choices?.[0]?.finish_reason,
        raw: json
      }
    },
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
          ...config.headers
        },
        body: JSON.stringify({
          model: config.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: true
        })
      })

      if (!response.ok || !response.body) {
        throw new Error(`Model stream failed with ${response.status}: ${await response.text()}`)
      }

      const decoder = new TextDecoder()
      let buffer = ""

      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue

          const data = trimmed.slice(5).trim()
          if (data === "[DONE]") return

          const parsed = JSON.parse(data) as OpenAICompatibleStreamChunk
          const text = parsed.choices?.[0]?.delta?.content
          if (text) yield text
        }
      }
    }
  })
}

type OpenAICompatibleResponse = {
  choices?: Array<{
    message?: { content?: string }
    finish_reason?: string
  }>
  usage?: unknown
}

type OpenAICompatibleStreamChunk = {
  choices?: Array<{
    delta?: { content?: string }
  }>
}
