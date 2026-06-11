# @agent-memory/anthropic

Anthropic model provider adapter for `agent-memory`, backed by the official `@anthropic-ai/sdk` TypeScript SDK.

```ts
import { createAgent } from "agent-memory"
import { anthropic } from "@agent-memory/anthropic"

const agent = createAgent({
  model: anthropic("anthropic-model")
})
```

Set `ANTHROPIC_API_KEY` in the environment, or pass `apiKey` explicitly.
