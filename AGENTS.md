# Pier Review

Single-user, local research app. The slice boundary is the Build order in `pier-review/initial-design/design-vision-v1.md` (Pecia): finish desktop acceptance before experiment execution.

- `projects/` holds trusted TypeScript definitions. `src/spec.ts` validates their data; importing a module executes code before that validation.
- `src/research.ts` owns durable conversations and tool permissions. Apply restrictions to nested code-mode calls as well as top-level tools. Preserve passive child reports across resume; do not enqueue a new model turn merely to display one.
- `src/docker.ts` owns the private agent environment; `src/notes.ts` owns host-side Pecia access. Fix workspace and credentials on the host, never from model arguments.
- `web/` is the React desk; `e2e/` starts the CLI, not a mock server in its place.

## Commands and environment

Use the repository pins and `.agents/setup` from its root. Run `pnpm exec task check` before handing off a change; Docker is required and no test needs credentials. Use `pnpm exec task fmt` for formatting. See [README](README.md) for live environment variables and how to distinguish a failed provider call from a failed Pecia call. There is no deployed Pier service.

## Style, errors and tests

- Use native TypeScript/Node and Pi Durable/Chord here, rather than Effect: this design uses Pi's persistence and cancellation model. Parse external input with schemas, including persisted state on reopen.
- Keep provider and Pecia credentials out of logs, transcripts and subprocesses that run model code. Report which operation failed and its status, not upstream response headers.
- Extend the public CLI/HTTP scenarios for user-facing behavior. Use supplied benign documents and loopback service doubles; do not point `task check` at a live wiki or model.
