# @agent-memory/gemini

Google Gemini model provider adapter for `agent-memory-sdk`, backed by the official `@google/genai` TypeScript SDK.

```ts
import { createAgent } from "agent-memory-sdk"
import { gemini } from "@agent-memory/gemini"

const agent = createAgent({
  model: gemini("gemini-2.5-pro")
})
```

Set `GEMINI_API_KEY` in the environment, or pass `apiKey` explicitly.
