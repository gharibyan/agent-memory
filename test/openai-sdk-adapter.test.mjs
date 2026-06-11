import assert from "node:assert/strict"
import { test } from "node:test"

test("openAICompatible uses an official-SDK-shaped client for generate", async () => {
  const { openAICompatible } = await import("../packages/openai/dist/index.js")
  const calls = []
  const provider = openAICompatible({
    id: "custom-sdk-client",
    model: "custom-chat",
    client: {
      chat: {
        completions: {
          async create(input) {
            calls.push(input)
            return {
              choices: [{
                message: {
                  content: "generated with sdk",
                  tool_calls: [{ id: "tool_1", type: "function" }]
                },
                finish_reason: "stop"
              }],
              usage: { total_tokens: 11 }
            }
          }
        }
      }
    }
  })
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error("manual fetch should not be used by the OpenAI adapter")
  }

  try {
    const result = await provider.generate({
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "lookup" } }],
      temperature: 0.2,
      maxTokens: 64
    })

    assert.equal(result.text, "generated with sdk")
    assert.equal(result.finishReason, "stop")
    assert.deepEqual(result.usage, { total_tokens: 11 })
    assert.deepEqual(result.toolCalls, [{ id: "tool_1", type: "function" }])
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], {
      model: "custom-chat",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "lookup" } }],
      temperature: 0.2,
      max_tokens: 64,
      stream: false
    })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test("openAICompatible streams through an official-SDK-shaped client", async () => {
  const { openAICompatible } = await import("../packages/openai/dist/index.js")
  const provider = openAICompatible({
    model: "custom-chat",
    client: {
      chat: {
        completions: {
          async create(input) {
            assert.equal(input.stream, true)
            return (async function * streamChunks() {
              yield { choices: [{ delta: { content: "one" } }] }
              yield { choices: [{ delta: { content: " two" } }] }
              yield { choices: [{ delta: {} }] }
            })()
          }
        }
      }
    }
  })
  const chunks = []

  for await (const chunk of provider.stream({
    messages: [{ role: "user", content: "stream" }]
  })) {
    chunks.push(chunk)
  }

  assert.deepEqual(chunks, ["one", " two"])
})

test("openai uses max_completion_tokens for first-party OpenAI chat models", async () => {
  const { openai } = await import("../packages/openai/dist/index.js")
  const calls = []
  const provider = openai({
    model: "gpt-5.4-mini",
    client: {
      chat: {
        completions: {
          async create(input) {
            calls.push(input)
            return {
              choices: [{
                message: { content: "openai response" },
                finish_reason: "stop"
              }]
            }
          }
        }
      }
    }
  })

  await provider.generate({
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 128
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].max_completion_tokens, 128)
  assert.equal("max_tokens" in calls[0], false)
})

test("openai streams with max_completion_tokens for first-party OpenAI chat models", async () => {
  const { openai } = await import("../packages/openai/dist/index.js")
  const calls = []
  const provider = openai({
    model: "gpt-5.4-mini",
    client: {
      chat: {
        completions: {
          async create(input) {
            calls.push(input)
            return (async function * streamChunks() {
              yield { choices: [{ delta: { content: "ok" } }] }
            })()
          }
        }
      }
    }
  })
  const chunks = []

  for await (const chunk of provider.stream({
    messages: [{ role: "user", content: "stream" }],
    maxTokens: 96
  })) {
    chunks.push(chunk)
  }

  assert.deepEqual(chunks, ["ok"])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].max_completion_tokens, 96)
  assert.equal("max_tokens" in calls[0], false)
})
