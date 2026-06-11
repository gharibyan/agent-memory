# @agent-memory/openai

OpenAI-compatible model provider adapter for `agent-memory`.

```ts
import { createAgent } from "agent-memory"
import { openAICompatible } from "@agent-memory/openai"

const agent = createAgent({
  model: openAICompatible({
    model: "deepseek-chat",
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY
  })
})
```

The adapter targets OpenAI-compatible chat completion APIs, including providers that expose compatible `/chat/completions` endpoints.
