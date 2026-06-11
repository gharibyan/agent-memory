import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  createAgent,
  customModel,
  localMemory
} from "@agent-memory/sdk"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const port = Number(process.env.PORT ?? 4317)

const agent = createAgent({
  model: customModel({
    id: "playground-echo-model",
    generate: async (request) => {
      const latestUser = request.messages.filter((message) => message.role === "user").at(-1)
      const memory = request.messages[0]?.role === "system"
        ? `\n\nI used this memory:\n${request.messages[0].content}`
        : ""

      return {
        text: `Playground response: ${latestUser?.content ?? ""}${memory}`
      }
    },
    async *stream(request) {
      const latestUser = request.messages.filter((message) => message.role === "user").at(-1)
      const text = `Playground stream: ${latestUser?.content ?? ""}`
      for (const chunk of text.match(/.{1,12}/g) ?? []) {
        yield chunk
      }
    }
  }),
  memory: localMemory({
    path: resolve(rootDir, ".memory/playground-memory.json")
  })
})

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`)

    if (req.method === "GET" && url.pathname === "/") {
      return sendHtml(res, page())
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = await readJson(req)
      const result = await agent.generate({
        userId: body.userId || undefined,
        orgId: body.orgId || undefined,
        threadId: body.threadId || undefined,
        operationId: body.operationId || undefined,
        messages: [{ role: "user", content: body.message ?? "" }],
        debug: true
      })
      return sendJson(res, result)
    }

    if (req.method === "POST" && url.pathname === "/api/stream") {
      const body = await readJson(req)
      const stream = await agent.stream({
        userId: body.userId || undefined,
        orgId: body.orgId || undefined,
        threadId: body.threadId || undefined,
        operationId: body.operationId || undefined,
        messages: [{ role: "user", content: body.message ?? "" }]
      })
      const text = await stream.text()
      const memories = await agent.memory.list({
        userId: body.userId || undefined,
        orgId: body.orgId || undefined,
        threadId: body.threadId || undefined,
        operationId: body.operationId || undefined
      })
      return sendJson(res, { text, memories })
    }

    if (req.method === "GET" && url.pathname === "/api/memory") {
      const memories = await agent.memory.list(scopeFromUrl(url))
      return sendJson(res, { memories })
    }

    if (req.method === "GET" && url.pathname === "/api/export") {
      const exported = await agent.memory.export(scopeFromUrl(url))
      return sendJson(res, exported)
    }

    if (req.method === "POST" && url.pathname === "/api/forget") {
      const body = await readJson(req)
      await agent.memory.forget({
        userId: body.userId || undefined,
        orgId: body.orgId || undefined,
        threadId: body.threadId || undefined,
        operationId: body.operationId || undefined
      })
      return sendJson(res, { ok: true })
    }

    sendJson(res, { error: "Not found" }, 404)
  } catch (error) {
    sendJson(res, { error: error.message }, 500)
  }
}).listen(port, () => {
  console.log(`agent-memory playground: http://localhost:${port}`)
})

function scopeFromUrl(url) {
  return {
    userId: url.searchParams.get("userId") || undefined,
    orgId: url.searchParams.get("orgId") || undefined,
    threadId: url.searchParams.get("threadId") || undefined,
    operationId: url.searchParams.get("operationId") || undefined
  }
}

async function readJson(req) {
  let body = ""
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
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
  <title>Agent Memory Playground</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #f6f7f8; color: #202326; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; display: grid; grid-template-columns: 360px 1fr; gap: 20px; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    label { display: grid; gap: 6px; font-size: 12px; color: #596067; margin-bottom: 12px; }
    input, textarea, button { font: inherit; border: 1px solid #c9ced4; border-radius: 6px; padding: 9px 10px; background: white; color: #202326; }
    textarea { min-height: 160px; resize: vertical; }
    button { cursor: pointer; background: #202326; color: white; border-color: #202326; }
    button.secondary { background: white; color: #202326; }
    section { background: white; border: 1px solid #dde1e5; border-radius: 8px; padding: 16px; }
    .stack { display: grid; gap: 12px; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    pre { margin: 0; background: #101214; color: #f2f5f7; border-radius: 6px; padding: 12px; overflow: auto; min-height: 180px; }
    .header { grid-column: 1 / -1; background: transparent; border: 0; padding: 0; }
    @media (max-width: 820px) { main { grid-template-columns: 1fr; padding: 16px; } }
  </style>
</head>
<body>
  <main>
    <section class="header">
      <h1>Agent Memory Playground</h1>
    </section>

    <section class="stack">
      <h2>Scope</h2>
      <label>User ID<input id="userId" placeholder="user_123"></label>
      <label>Org ID<input id="orgId" placeholder="org_456"></label>
      <label>Thread ID<input id="threadId" placeholder="thread_789"></label>
      <label>Operation ID<input id="operationId" placeholder="op_abc"></label>
      <label>Message<textarea id="message">Remember that I prefer concise weekly reports.</textarea></label>
      <div class="row">
        <button id="generate">Generate</button>
        <button id="stream" class="secondary">Stream</button>
      </div>
      <div class="row">
        <button id="list" class="secondary">List Memory</button>
        <button id="forget" class="secondary">Forget</button>
        <button id="export" class="secondary">Export</button>
      </div>
    </section>

    <section class="stack">
      <h2>Output</h2>
      <pre id="output">{}</pre>
    </section>
  </main>

  <script>
    const output = document.querySelector("#output")
    const payload = () => ({
      userId: document.querySelector("#userId").value,
      orgId: document.querySelector("#orgId").value,
      threadId: document.querySelector("#threadId").value,
      operationId: document.querySelector("#operationId").value,
      message: document.querySelector("#message").value
    })
    const scopeQuery = () => new URLSearchParams({
      userId: document.querySelector("#userId").value,
      orgId: document.querySelector("#orgId").value,
      threadId: document.querySelector("#threadId").value,
      operationId: document.querySelector("#operationId").value
    })
    const show = (value) => { output.textContent = JSON.stringify(value, null, 2) }
    async function post(path) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload())
      })
      show(await res.json())
    }
    document.querySelector("#generate").onclick = () => post("/api/generate")
    document.querySelector("#stream").onclick = () => post("/api/stream")
    document.querySelector("#forget").onclick = () => post("/api/forget")
    document.querySelector("#list").onclick = async () => show(await (await fetch("/api/memory?" + scopeQuery())).json())
    document.querySelector("#export").onclick = async () => show(await (await fetch("/api/export?" + scopeQuery())).json())
  </script>
</body>
</html>`
}
