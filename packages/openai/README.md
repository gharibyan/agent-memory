# @agent-memory/openai

OpenAI model provider adapter for `agent-memory`, backed by the official `openai` TypeScript SDK.

```ts
import { createAgent } from "agent-memory"
import { openai } from "@agent-memory/openai"

const agent = createAgent({
  model: openai("gpt-5")
})
```

For custom models or providers that expose an OpenAI-compatible chat completions API, use `openAICompatible()`:

```ts
import { openAICompatible } from "@agent-memory/openai"

const model = openAICompatible({
  model: "deepseek-chat",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.DEEPSEEK_API_KEY
})
```
