# Pier workspace

A pnpm monorepo for independently runnable projects and shared packages.

## Layout

```text
apps/
  pier-review/       # Local research desk: CLI, server, React UI and end-to-end tests
packages/            # Shared libraries (create as needed)
.agents/setup        # Workspace bootstrap
Taskfile.yml         # Workspace-wide commands
```

[**Pier Review documentation**](apps/pier-review/README.md) covers the research desk, credentials, data boundaries and local development. Its trusted research definitions live in `apps/pier-review/projects/`; those are app configuration, not workspace packages.

## Getting started

Use Node **26.12.1** (`.node-version`), pnpm **12.21.0**, Bash and a running local Docker Engine. From the repository root:

```sh
.agents/setup
./pier serve
```

Setup installs the shared lockfile, caches the agent image and builds the apps. The root `pier` launcher is a convenience entry point for Pier Review; the app also has its own launcher at `apps/pier-review/pier`. Both work from other working directories, including via a symlink on `PATH`.

## Workspace commands

Run from the repository root:

```sh
pnpm exec task check       # Formatting, lint, typechecks, builds and tests for all projects
pnpm exec task fmt         # Format the whole repository
pnpm exec task build       # Build all projects
pnpm exec task dev         # Start Pier Review
pnpm exec task --list
```

Target one app with pnpm's workspace filter:

```sh
pnpm --filter pier-review build
pnpm --filter pier-review test
pnpm --filter pier-review dev
```

Pier Review's tests use real Docker and loopback service doubles, not live credentials. CI runs the same root checks.

## Adding a project

1. Create `apps/<name>/package.json` for an application, or `packages/<name>/package.json` for a shared library. Give it a unique package name and mark non-published packages `private`.
2. Declare runtime dependencies and app-specific tools in that package. Formatting, lint tooling, Task and TypeScript are shared at the root. Extend the root `tsconfig.json` and override `include` and any project-specific compiler options.
3. Add the relevant `build`, `lint`, `typecheck` and `test` scripts. Root tasks run these scripts recursively, skipping packages without that script. Tests should build any required assets first. Packages can use their own Taskfile, as Pier Review does, or implement scripts directly.
4. Use `workspace:*` for dependencies on other workspace packages, then run `pnpm install` from the root and commit the single updated `pnpm-lock.yaml`.

Keep app code, fixtures, tests, documentation and generated output inside its own directory. Root formatting, lint configuration, Node/pnpm pins, CI and the dependency lockfile are shared.
