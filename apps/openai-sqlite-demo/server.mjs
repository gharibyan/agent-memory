import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createAgent, openai, sqliteMemory } from "agent-memory"

const appDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(appDir, "../..")

await loadEnvFile(resolve(rootDir, ".env"))
await loadEnvFile(resolve(appDir, ".env"))

const port = Number(process.env.PORT ?? 4318)
const model = process.env.OPENAI_MODEL || "gpt-5.4-mini"
const contextBudget = Number(process.env.AGENT_MEMORY_DEMO_CONTEXT_BUDGET ?? 1400)
const memoryPath = resolve(rootDir, process.env.AGENT_MEMORY_DEMO_SQLITE_PATH ?? ".memory/openai-demo.sqlite")
const hasOpenAIKey = () => Boolean(process.env.OPENAI_API_KEY?.trim())

const agent = createAgent({
  model: openai(model),
  memory: {
    store: sqliteMemory({
      path: memoryPath
    }),
    contextBudget
  }
})

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`)

    if (req.method === "GET" && url.pathname === "/") {
      return sendHtml(res, page())
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, statusPayload())
    }

    if (req.method === "GET" && url.pathname === "/api/memory") {
      const scope = scopeFromUrl(url)
      const [memories, exported] = await Promise.all([
        agent.memory.list({ ...scope, limit: 50 }),
        agent.memory.export(scope)
      ])
      return sendJson(res, {
        memories,
        events: recentEvents(exported.events)
      })
    }

    if (req.method === "GET" && url.pathname === "/api/export") {
      return sendJson(res, await agent.memory.export(scopeFromUrl(url)))
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      if (!hasOpenAIKey()) return sendJson(res, missingKeyPayload(), 400)

      const body = await readJson(req)
      const scope = scopeFromBody(body)
      const message = String(body.message ?? "").trim()
      if (!message) return sendJson(res, { error: "Message is required." }, 400)

      const result = await agent.generate({
        ...scope,
        system: systemPrompt(),
        messages: [{ role: "user", content: message }],
        temperature: numberOrUndefined(body.temperature),
        maxTokens: numberOrUndefined(body.maxTokens),
        debug: true,
        memory: {
          recall: body.recall !== false,
          learn: body.learn !== false,
          contextBudget: numberOrUndefined(body.contextBudget) ?? contextBudget
        }
      })
      const [memories, exported] = await Promise.all([
        agent.memory.list({ ...scope, limit: 50 }),
        agent.memory.export(scope)
      ])

      return sendJson(res, {
        text: result.text,
        usage: result.usage,
        finishReason: result.finishReason,
        memory: result.memory,
        memories,
        events: recentEvents(exported.events),
        status: statusPayload()
      })
    }

    if (req.method === "POST" && url.pathname === "/api/forget") {
      const body = await readJson(req)
      await agent.memory.forget(scopeFromBody(body))
      return sendJson(res, { ok: true })
    }

    return sendJson(res, { error: "Not found" }, 404)
  } catch (error) {
    return sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500)
  }
}).listen(port, () => {
  console.log(`agent-memory OpenAI SQLite demo: http://localhost:${port}`)
})

async function loadEnvFile(path) {
  if (!existsSync(path)) return

  const content = await readFile(path, "utf8")
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const separator = trimmed.indexOf("=")
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    const value = unquoteEnvValue(trimmed.slice(separator + 1).trim())
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function systemPrompt() {
  return [
    "You are the agent-memory OpenAI SQLite demo assistant.",
    "Use recalled memory when it is relevant, but do not invent memory.",
    "Keep responses concise and mention when a remembered preference changed your answer."
  ].join(" ")
}

function scopeFromUrl(url) {
  return {
    userId: url.searchParams.get("userId") || undefined,
    orgId: url.searchParams.get("orgId") || undefined,
    threadId: url.searchParams.get("threadId") || undefined,
    operationId: url.searchParams.get("operationId") || undefined
  }
}

function scopeFromBody(body) {
  return {
    userId: cleanOptionalString(body.userId),
    orgId: cleanOptionalString(body.orgId),
    threadId: cleanOptionalString(body.threadId),
    operationId: cleanOptionalString(body.operationId)
  }
}

function cleanOptionalString(value) {
  const text = String(value ?? "").trim()
  return text || undefined
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === "") return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

async function readJson(req) {
  let body = ""
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

function recentEvents(events) {
  return [...events]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
}

function statusPayload() {
  return {
    hasOpenAIKey: hasOpenAIKey(),
    model,
    memoryPath: relative(rootDir, memoryPath),
    contextBudget
  }
}

function missingKeyPayload() {
  return {
    error: "OPENAI_API_KEY is not configured.",
    setup: "Copy apps/openai-sqlite-demo/.env.example to apps/openai-sqlite-demo/.env and set OPENAI_API_KEY on the server."
  }
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(value, null, 2))
}

function sendHtml(res, html) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(html)
}

function page() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenAI SQLite Memory Demo</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f6f8;
      --panel: #ffffff;
      --line: #d8dde3;
      --text: #1e2329;
      --muted: #626c77;
      --blue: #2457d6;
      --green: #1f7a4d;
      --amber: #93670f;
      --red: #b42318;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    main { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    header { padding: 18px 22px; border-bottom: 1px solid var(--line); background: var(--panel); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { font-size: 18px; line-height: 1.2; margin: 0; }
    h2 { font-size: 13px; margin: 0; color: var(--muted); font-weight: 650; text-transform: uppercase; }
    label { display: grid; gap: 6px; font-size: 12px; color: var(--muted); }
    input, textarea, button, select { font: inherit; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--text); }
    input, textarea, select { padding: 9px 10px; width: 100%; }
    textarea { min-height: 132px; resize: vertical; line-height: 1.45; }
    button { padding: 9px 12px; cursor: pointer; background: #fff; display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
    button.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
    button.danger { color: var(--red); border-color: #f0b8b3; }
    button:disabled { opacity: .6; cursor: not-allowed; }
    pre { margin: 0; overflow: auto; background: #11151a; color: #eef3f8; border-radius: 6px; padding: 12px; min-height: 178px; font-size: 12px; line-height: 1.45; }
    .status { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 4px 8px; background: #fff; }
    .pill.ok { color: var(--green); border-color: #b8dec9; }
    .pill.warn { color: var(--amber); border-color: #ead29a; }
    .workspace { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr) minmax(300px, 420px); gap: 14px; padding: 14px; min-height: 0; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; display: grid; gap: 12px; align-content: start; min-width: 0; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .chat { min-height: 0; grid-template-rows: auto 1fr auto; }
    .messages { display: grid; align-content: start; gap: 10px; overflow: auto; min-height: 360px; padding-right: 4px; }
    .message { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: #fbfcfd; white-space: pre-wrap; line-height: 1.45; }
    .message.assistant { border-color: #cbd7ff; background: #f7f9ff; }
    .message.user { border-color: #d5e8dd; background: #f8fcfa; }
    .meta { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
    .memory-list { display: grid; gap: 8px; max-height: 260px; overflow: auto; }
    .memory { border: 1px solid var(--line); border-radius: 8px; padding: 9px; background: #fbfcfd; }
    .memory strong { display: block; font-size: 12px; margin-bottom: 4px; }
    .memory p { margin: 0; color: var(--text); font-size: 13px; line-height: 1.35; }
    .empty { color: var(--muted); font-size: 13px; padding: 10px; border: 1px dashed var(--line); border-radius: 8px; }
    .toggles { display: grid; gap: 8px; }
    .toggle { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--text); }
    .toggle input { width: auto; }
    @media (max-width: 1080px) { .workspace { grid-template-columns: 320px 1fr; } .inspector { grid-column: 1 / -1; } }
    @media (max-width: 760px) { header { align-items: flex-start; flex-direction: column; } .workspace { grid-template-columns: 1fr; } .grid2 { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>OpenAI SQLite Memory Demo</h1>
      <div class="status">
        <span id="keyStatus" class="pill warn">Key missing</span>
        <span id="modelStatus" class="pill">model</span>
        <span id="dbStatus" class="pill">database</span>
      </div>
    </header>

    <div class="workspace">
      <section class="panel">
        <h2>Scope</h2>
        <div class="grid2">
          <label>User<input id="userId" value="demo-user"></label>
          <label>Thread<input id="threadId" value="demo-thread"></label>
        </div>
        <div class="grid2">
          <label>Org<input id="orgId" placeholder="optional"></label>
          <label>Operation<input id="operationId" value="demo-onboarding"></label>
        </div>
        <div class="grid2">
          <label>Temperature<input id="temperature" type="number" min="0" max="2" step="0.1" value="0.3"></label>
          <label>Max tokens<input id="maxTokens" type="number" min="64" step="32" value="512"></label>
        </div>
        <label>Context budget<input id="contextBudget" type="number" min="200" step="100" value="1400"></label>
        <div class="toggles">
          <label class="toggle"><input id="recall" type="checkbox" checked> Recall memory</label>
          <label class="toggle"><input id="learn" type="checkbox" checked> Learn from this message</label>
        </div>
        <div class="row">
          <button data-example="Remember that I prefer concise answers with bullet points.">Preference</button>
          <button data-example="Remember that I work at Northstar Labs.">Fact</button>
          <button data-example="Do not use emojis in product updates.">Constraint</button>
        </div>
        <div class="row">
          <button id="refresh">Refresh</button>
          <button id="forget" class="danger">Forget scope</button>
        </div>
      </section>

      <section class="panel chat">
        <h2>Conversation</h2>
        <div id="messages" class="messages"></div>
        <label>Message<textarea id="message">Remember that I prefer concise answers with bullet points.</textarea></label>
        <div class="row">
          <button id="send" class="primary">Send</button>
          <button id="ask">Ask with memory</button>
        </div>
      </section>

      <section class="panel inspector">
        <h2>Memory</h2>
        <div id="memoryList" class="memory-list"></div>
        <h2>Debug</h2>
        <pre id="debug">{}</pre>
      </section>
    </div>
  </main>

  <script>
    const state = {
      messages: []
    }
    const els = {
      ask: document.querySelector("#ask"),
      dbStatus: document.querySelector("#dbStatus"),
      debug: document.querySelector("#debug"),
      forget: document.querySelector("#forget"),
      keyStatus: document.querySelector("#keyStatus"),
      learn: document.querySelector("#learn"),
      maxTokens: document.querySelector("#maxTokens"),
      memoryList: document.querySelector("#memoryList"),
      message: document.querySelector("#message"),
      messages: document.querySelector("#messages"),
      modelStatus: document.querySelector("#modelStatus"),
      operationId: document.querySelector("#operationId"),
      orgId: document.querySelector("#orgId"),
      recall: document.querySelector("#recall"),
      refresh: document.querySelector("#refresh"),
      send: document.querySelector("#send"),
      temperature: document.querySelector("#temperature"),
      contextBudget: document.querySelector("#contextBudget"),
      threadId: document.querySelector("#threadId"),
      userId: document.querySelector("#userId")
    }

    function scope() {
      return {
        userId: els.userId.value,
        orgId: els.orgId.value,
        threadId: els.threadId.value,
        operationId: els.operationId.value
      }
    }

    function payload() {
      return {
        ...scope(),
        message: els.message.value,
        temperature: els.temperature.value,
        maxTokens: els.maxTokens.value,
        contextBudget: els.contextBudget.value,
        recall: els.recall.checked,
        learn: els.learn.checked
      }
    }

    function scopeQuery() {
      return new URLSearchParams(scope())
    }

    async function json(path, options) {
      const res = await fetch(path, options)
      const body = await res.json()
      if (!res.ok) throw body
      return body
    }

    function renderMessages() {
      els.messages.innerHTML = state.messages.length
        ? state.messages.map((message) => (
          '<div class="message ' + message.role + '">' +
          '<div class="meta">' + message.role + '</div>' +
          escapeHtml(message.content) +
          '</div>'
        )).join("")
        : '<div class="empty">No messages yet.</div>'
      els.messages.scrollTop = els.messages.scrollHeight
    }

    function renderMemory(memories) {
      els.memoryList.innerHTML = memories?.length
        ? memories.map((memory) => (
          '<div class="memory">' +
          '<strong>' + escapeHtml(memory.type) + ' · ' + Math.round(memory.importance * 100) + '</strong>' +
          '<p>' + escapeHtml(memory.content) + '</p>' +
          '</div>'
        )).join("")
        : '<div class="empty">No active memory for this scope.</div>'
    }

    function renderStatus(status) {
      els.keyStatus.textContent = status.hasOpenAIKey ? "Key configured" : "Key missing"
      els.keyStatus.className = "pill " + (status.hasOpenAIKey ? "ok" : "warn")
      els.modelStatus.textContent = status.model
      els.dbStatus.textContent = status.memoryPath
      els.contextBudget.value = status.contextBudget
    }

    function renderDebug(value) {
      els.debug.textContent = JSON.stringify(value, null, 2)
    }

    async function refresh() {
      const [status, memory] = await Promise.all([
        json("/api/status"),
        json("/api/memory?" + scopeQuery())
      ])
      renderStatus(status)
      renderMemory(memory.memories)
      renderDebug({ status, memories: memory.memories, events: memory.events })
    }

    async function send(message) {
      const text = message ?? els.message.value
      if (!text.trim()) return
      setBusy(true)
      state.messages.push({ role: "user", content: text })
      renderMessages()
      try {
        const result = await json("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload(), message: text })
        })
        state.messages.push({ role: "assistant", content: result.text })
        renderStatus(result.status)
        renderMemory(result.memories)
        renderDebug(result)
      } catch (error) {
        renderDebug(error)
      } finally {
        setBusy(false)
        renderMessages()
      }
    }

    function setBusy(value) {
      els.send.disabled = value
      els.ask.disabled = value
      els.refresh.disabled = value
      els.forget.disabled = value
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;")
    }

    document.querySelectorAll("[data-example]").forEach((button) => {
      button.addEventListener("click", () => {
        els.message.value = button.dataset.example
      })
    })
    els.send.addEventListener("click", () => send())
    els.ask.addEventListener("click", () => {
      els.message.value = "What should you remember about how I like updates?"
      send()
    })
    els.refresh.addEventListener("click", refresh)
    els.forget.addEventListener("click", async () => {
      await json("/api/forget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scope())
      })
      state.messages = []
      renderMessages()
      await refresh()
    })

    renderMessages()
    refresh().catch(renderDebug)
  </script>
</body>
</html>`
}
