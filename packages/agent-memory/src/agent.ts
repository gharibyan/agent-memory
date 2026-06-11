import { createAgent as createCoreAgent } from "@agent-memory/core"
import { localMemory } from "@agent-memory/local"
import type { Agent, AgentConfig } from "@agent-memory/core"

export function createAgent(config: AgentConfig): Agent {
  const memory = config.memory === undefined || config.memory === "auto"
    ? localMemory()
    : config.memory

  return createCoreAgent({
    ...config,
    memory
  })
}
