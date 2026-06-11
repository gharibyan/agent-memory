import type { ModelProvider } from "./types.js"

export function customModel(provider: Partial<ModelProvider> & { id: string }): ModelProvider {
  if (!provider.id) {
    throw new Error("customModel() requires an id")
  }

  if (typeof provider.generate !== "function" && typeof provider.stream !== "function") {
    throw new Error("customModel() requires generate() or stream()")
  }

  return {
    id: provider.id,
    capabilities: {
      streaming: typeof provider.stream === "function",
      tools: false,
      jsonSchema: false,
      vision: false,
      ...provider.capabilities
    },
    generate: provider.generate,
    stream: provider.stream
  }
}
