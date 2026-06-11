import assert from "node:assert/strict"
import { test } from "node:test"

test("anthropic adapter generates and streams through the official SDK client shape", async () => {
  const { anthropic } = await import("../packages/anthropic/dist/index.js")
  const calls = []
  const provider = anthropic({
    id: "anthropic-test",
    model: "anthropic-model",
    client: {
      messages: {
        async create(input) {
          calls.push(input)
          if (input.stream) {
            return (async function * events() {
              yield { type: "content_block_delta", delta: { type: "text_delta", text: "hel" } }
              yield { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }
            })()
          }

          return {
            content: [{ type: "text", text: "anthropic text" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 3, output_tokens: 4 }
          }
        }
      }
    }
  })

  const result = await provider.generate({
    system: "system rule",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.3,
    maxTokens: 77
  })
  const chunks = []
  for await (const chunk of provider.stream({ messages: [{ role: "user", content: "stream" }] })) {
    chunks.push(chunk)
  }

  assert.equal(provider.id, "anthropic-test")
  assert.equal(result.text, "anthropic text")
  assert.equal(result.finishReason, "end_turn")
  assert.deepEqual(result.usage, { input_tokens: 3, output_tokens: 4 })
  assert.equal(calls[0].model, "anthropic-model")
  assert.equal(calls[0].system, "system rule")
  assert.deepEqual(calls[0].messages, [{ role: "user", content: "hello" }])
  assert.equal(calls[0].temperature, 0.3)
  assert.equal(calls[0].max_tokens, 77)
  assert.equal(calls[0].stream, false)
  assert.deepEqual(chunks, ["hel", "lo"])
})

test("gemini adapter generates and streams through the official SDK client shape", async () => {
  const { gemini } = await import("../packages/gemini/dist/index.js")
  const calls = []
  const provider = gemini({
    model: "gemini-test",
    client: {
      models: {
        async generateContent(input) {
          calls.push(["generate", input])
          return { text: "gemini text", usageMetadata: { totalTokenCount: 12 } }
        },
        async generateContentStream(input) {
          calls.push(["stream", input])
          return (async function * chunks() {
            yield { text: "gem" }
            yield { candidates: [{ content: { parts: [{ text: "ini" }] } }] }
          })()
        }
      }
    }
  })

  const result = await provider.generate({
    system: "gemini system",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.4,
    maxTokens: 88
  })
  const chunks = []
  for await (const chunk of provider.stream({ messages: [{ role: "user", content: "stream" }] })) {
    chunks.push(chunk)
  }

  assert.equal(provider.id, "gemini:gemini-test")
  assert.equal(result.text, "gemini text")
  assert.deepEqual(result.usage, { totalTokenCount: 12 })
  assert.equal(calls[0][0], "generate")
  assert.equal(calls[0][1].model, "gemini-test")
  assert.deepEqual(calls[0][1].contents, [{ role: "user", parts: [{ text: "hello" }] }])
  assert.deepEqual(calls[0][1].config, {
    systemInstruction: "gemini system",
    temperature: 0.4,
    maxOutputTokens: 88
  })
  assert.deepEqual(chunks, ["gem", "ini"])
})

test("xai adapter uses the documented OpenAI SDK client shape with xAI defaults", async () => {
  const { xai } = await import("../packages/xai/dist/index.js")
  const calls = []
  const provider = xai({
    model: "grok-test",
    client: {
      chat: {
        completions: {
          async create(input) {
            calls.push(input)
            if (input.stream) {
              return (async function * chunks() {
                yield { choices: [{ delta: { content: "gr" } }] }
                yield { choices: [{ delta: { content: "ok" } }] }
              })()
            }

            return {
              choices: [{
                message: { content: "xai text" },
                finish_reason: "stop"
              }],
              usage: { total_tokens: 10 }
            }
          }
        }
      }
    }
  })

  const result = await provider.generate({
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.5,
    maxTokens: 99
  })
  const chunks = []
  for await (const chunk of provider.stream({ messages: [{ role: "user", content: "stream" }] })) {
    chunks.push(chunk)
  }

  assert.equal(provider.id, "xai:grok-test")
  assert.equal(result.text, "xai text")
  assert.equal(result.finishReason, "stop")
  assert.deepEqual(result.usage, { total_tokens: 10 })
  assert.deepEqual(calls[0], {
    model: "grok-test",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.5,
    max_tokens: 99,
    stream: false
  })
  assert.deepEqual(chunks, ["gr", "ok"])
})
