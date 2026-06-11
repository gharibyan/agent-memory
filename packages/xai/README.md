# @agent-memory/xai

xAI model provider adapter for `agent-memory-sdk`, using the documented OpenAI SDK-compatible client path with xAI defaults.

```ts
import { createAgent } from "agent-memory-sdk"
import { xai } from "@agent-memory/xai"

const agent = createAgent({
  model: xai("grok-4")
})
```

Set `XAI_API_KEY` in the environment, or pass `apiKey` explicitly.
