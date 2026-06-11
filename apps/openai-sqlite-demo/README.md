# OpenAI SQLite Demo

Interactive server-side example that calls OpenAI with `OPENAI_API_KEY` and stores compounding memory in SQLite through `sqliteMemory()`.

The browser never receives the API key. The server reads `OPENAI_API_KEY`, creates an `openai()` model provider, and persists memory to `.memory/openai-demo.sqlite` by default.

## Run Locally

```sh
cp apps/openai-sqlite-demo/.env.example apps/openai-sqlite-demo/.env
pnpm --filter @agent-memory/openai-sqlite-demo dev
```

Then open [http://localhost:4318](http://localhost:4318).

Set these values in `apps/openai-sqlite-demo/.env` or in your deployment environment:

```sh
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
AGENT_MEMORY_DEMO_SQLITE_PATH=.memory/openai-demo.sqlite
AGENT_MEMORY_DEMO_CONTEXT_BUDGET=1400
PORT=4318
```

## Deployment

Deploy this demo to a server runtime, not a static-only host. Good targets include a VM, container host, Codespaces-style development environment, or any Node server platform that can set environment variables securely.

Do not put `OPENAI_API_KEY` in browser code, static hosting config, checked-in files, or client-side environment variables.
