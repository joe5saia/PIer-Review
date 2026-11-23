# Pier Review

Pier Review runs a single-user research desk on your machine. Create a space, give its organizer (the coordinator agent) a document and a question, and follow the researcher and Reader it delegates to. The coordinator's conversation stays in the column beside the sidebar. The right side has tabs: **Briefing** shows the top-level goal, each sub-goal with its thread, and a running HTML account the coordinator keeps current; **Threads** opens the conversation tree, and any thread at any depth opens in its own tab where you can talk to it. When you talk to a thread directly, its report wakes its supervisor, and so on up to the coordinator; threads below are told about relevant changes as notes, without starting work. Open **Notes** to read the evidence they saved.

## Run the survey without credentials

Use Node **26.12.1** (`.node-version`), pnpm **12.21.0**, Bash, and a running local Docker Engine on Linux x64 or arm64. Docker must be accessible to the user running Pier, and able to bind-mount files from this checkout. Run from the repository root:

```sh
.agents/setup
./pier serve
```

Setup installs the locked dependencies, caches the pinned Linux container image and builds the UI. It needs network on first install; the default research session does not. No global Task installation is needed. To use the spelling `pier serve` from another directory, symlink the `pier` executable into a directory on your `PATH`.

Open the **address printed by the CLI**. Create `harbor-survey` with the supplied source. Send “Total the visits and save the evidence.” Expect **23 visits across three sites**; change the input numbers to change the result. Open the Reader to inspect its calculation, or send it a follow-up. The offline provider follows this survey routine; it is not a general-purpose model. `Ctrl-C`, then `./pier serve` again to reopen the desk.

Ask the Reader “Which site had the most visits?” It cites the existing observations and shares its answer with the coordinator. If counts are missing, reply with `East dock: 5 / West dock: 0` in the waiting thread or its parent: the same Reader resumes. You can also edit **Source document** before replying. Enter sends; Shift+Enter inserts a line break. Bookmark a thread or cited note to reopen it directly after restarting.

## Run with a model and Pecia

Use a disposable project on a Pecia test stage first. Export these credentials from your secret store into the **server process**; do not put them in the source document, project definition or git. Pier does not read `.env` automatically.

| Setting | Used for |
| --- | --- |
| `PIER_MODE=live` | Enable real model calls and real Pecia writes. Default: `fixture`. |
| `OPENAI_API_KEY` | OpenAI Responses access to the configured models (`gpt-5` and `gpt-5-mini` by default). Messages, source excerpts and tool results can reach the provider. |
| `PECIA_URL`, `PECIA_ORCHESTRATOR_KEY` | HTTPS stage origin and orchestrator bearer for workspace provisioning, tree/file reads and new Markdown pages. |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Service-token headers for stages that protect the REST endpoints with Cloudflare Access. |
| `PECIA_MCP_TOKEN` | Optional, unexpired Pecia OAuth access token with `wiki:read` for project page comments. Without it, no comments tool is advertised. Pier does not refresh tokens. |

After setting these, run `./pier serve`. Check for **live mode**, create a fresh unique project name, and ask the coordinator to delegate a count to a Reader and save the evidence. Check the result against the source, then open the cited page in the same Pecia stage. Creating a live project provisions a real workspace of that name. Publishing creates a **new** page; existing pages are never replaced. If the model cannot access its configured model ID, select an available OpenAI model in a trusted project definition. If Pecia refuses a call, check the stage, token scope and Access policy before retrying.

## Data and execution boundaries

- `PIER_DATA` defaults to `~/.pier`. Fixture and live data use separate subdirectories. They hold project definitions and source, per-thread Pi Durable SQLite databases, and (in fixture mode only) local Markdown. A server takes an exclusive lease on its data directory. Stop it before copying that directory for a backup.
- Each thread has a non-root Docker environment with no network, dropped capabilities, a read-only root and bounded writable tmpfs. It can read its own `/work/source.md`; it cannot access the host's Docker socket or keys. Normal shutdown removes its containers. After an abrupt stop, restart against the same data to reattach and resume.
- The trusted Node process owns the model and Pecia clients, durable harnesses and QuickJS sandboxes. Model code runs in a memory- and time-limited QuickJS guest, **not** in host JavaScript. It can call only that agent’s registered tools; no arbitrary shell, network fetch or model access is exposed. Docker isolates agent files, not the trusted host adapters. The server listens only on loopback; do not publish it as a multi-user service.
- `PIER_PROJECT=/absolute/path/to/project.ts` selects a trusted TypeScript module exporting `defineProject(...)`; see `projects/default.ts`. Imports execute on the host: review the module before using it. The validated definition is copied into each new project. `PORT` changes the listening port (default 4317).
- No experiment locks, trials, scoring, `verify` or remote execution in this slice.

## Development checks

`pnpm exec task check` runs formatting, type-aware lint, both TypeScript checkers, a Vite build and Docker-backed end-to-end tests. They start the actual CLI in temporary data directories: one exercises delegation and restart after a process kill; another uses the real live-mode clients with loopback Responses, Pecia HTTP and MCP doubles. They need no live credentials. `pnpm exec task dev` rebuilds the UI and starts the desk; `pnpm exec task --list` lists the other tasks.
