# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev Container

All commands must run inside the devcontainer. The container service is `app` in `.devcontainer/docker-compose.yml`. It mounts Docker socket so Cloudflare Containers work during local dev.

```bash
# Check if container is running
docker compose -f .devcontainer/docker-compose.yml ps

# Run commands in the container
docker compose -f .devcontainer/docker-compose.yml exec app pnpm dev
docker compose -f .devcontainer/docker-compose.yml exec app pnpm check

# Start the container if not running (destroy after task)
docker compose -f .devcontainer/docker-compose.yml up -d
docker compose -f .devcontainer/docker-compose.yml down  # destroy when done
```

Dev server runs at `http://localhost:8787` (port forwarded from container).

## Commands

Inside the container:

```bash
pnpm dev              # Vite + Wrangler dev server on :8787
pnpm build            # production build
pnpm build:prod       # build with CLOUDFLARE_ENV=prod
pnpm test             # Vitest integration tests (workerd pool)
pnpm test:converter   # Go converter unit tests
pnpm test:converter:integration  # Go converter integration tests (slow)
pnpm check            # Biome format + lint (run this before reporting done)
pnpm knip             # detect unused exports/files/packages
pnpm typecheck        # tsc type check
pnpm db:generate      # generate Drizzle migrations from src/db/schema.ts
pnpm db:apply         # apply D1 migrations locally
pnpm deploy           # apply remote migrations + wrangler deploy
pnpm cf-typegen       # regenerate worker-configuration.d.ts from wrangler.jsonc
```

**Required after every coding task:** `pnpm check && pnpm knip && pnpm typecheck`

If Biome reports auto-fixable issues: `pnpm exec biome check --write .` then rerun `pnpm check`.

## Architecture

### Code organization — vertical slices

Code is grouped by **feature**, not by technical layer:

```
src/
  features/<feature>/   books, files, conversion, shelves, kobo, tasks, users
    services/           Effect.Service business logic
    tests/              integration tests for that slice's services
    server/             createServerFn handlers (imported by routes)
    hooks/              React hooks
    components/         React components
    queue/  lib/        feature queue handlers / feature-local helpers
  shared/               cross-cutting infra: layers, server, queue, db, auth, lib, integrations, test
  components/           app shell (Header, ThemeToggle) + ui/ (shadcn design system)
  routes/               TanStack file-based routes (must stay here) — thin, import from features
  index.ts scheduled.ts router.tsx queue/index.ts   root wiring
```

Feature dependency graph is **acyclic** (enforce this when adding cross-feature imports):
`files ← books ← conversion ← kobo ← shelves`, plus `tasks → conversion`, `users` standalone. Cross-feature imports reference another slice's `services`/`server`/`hooks` directly (e.g. `#/features/kobo/services/KoboService`). Never add a back-edge (e.g. `kobo` importing `shelves`); the kobo-settings page composes both features at the **route** level instead.

### Request flow

`src/index.ts` is the Worker entrypoint. It exports:
- `default.fetch` — forwards to TanStack Start SSR server, with special Kobo request normalization (duplicate slashes and non-HTML `accept` headers)
- `default.queue` — `src/queue/index.ts` dispatcher routes `calibre-conversion`/`calibre-metadata` to feature queue handlers (`src/features/conversion/queue/`, `src/features/books/queue/`)
- `default.scheduled` — cron handler (every 15 min) in `src/scheduled.ts`
- `ConverterContainer` — Durable Object backed by a Cloudflare Container (Go binary in `src/containers/converter/`)

### Frontend / routing

File-based routing via TanStack Router. Route files in `src/routes/` auto-generate `src/routeTree.gen.ts` — **never edit that file manually**. Routes are thin composers that import feature `server`/`hooks`/`components`.

### Server functions

`src/features/<feature>/server/*.ts` contain `createServerFn()` calls (TanStack Start) — the bridge between React routes and Effect services.

### Effect service layer

Business logic lives in `src/features/<feature>/services/PascalCase.ts`. Each file exports one `Effect.Service` class with `accessors: true` and explicit `dependencies`, so call sites read `BookService.getBookById(id)`. Wrap each method in `Effect.fn("Service.method")` — that is what produces spans and call-site stack traces.

Keep pure helpers (header parsing, encoders, formatters) as plain module-level exports next to the service, not as service methods.

Layers are composed in `src/shared/layers/`:
- `DatabaseLive` — Drizzle + `@effect/sql-d1`
- `R2Live` — Cloudflare R2 bucket
- `ConverterContainerLive` — Durable Object proxy for converter

`AppLayer` merges `DatabaseLive`, `R2Live` and every service's `.Default`.
`AppLayerWithContainer = merge(AppLayer, ConverterContainerLive)` — queue and cron only.
`AppServices` is the derived context type; boundaries that accept a caller's Effect should require it rather than naming individual tags.

**Never add `ConverterContainerLive` to a service's `dependencies`** — tests substitute a fake for that tag.

### Runtime boundaries

Layer memoization only holds within one `Effect.provide` build, so never call `Effect.provide(AppLayer)` per request. `src/shared/layers/AppRuntime.ts` exports two module-scope `ManagedRuntime`s:
- `ServerRuntime` — SSR, server functions, API routes
- `QueueRuntime` — queue consumers and the cron handler

Server functions go through `runServerEffect` (`src/shared/server/`), which runs on `ServerRuntime` and maps tagged errors to HTTP status via `serverErrors.ts`. Add a tag there when you add a domain error; anything unmapped becomes a logged 500 with a generic message.

Route **loaders** are different: a loader that throws renders the error boundary and answers 500 regardless of status, so translate absence into router `notFound()` (see `getBookByIdServerFn`, `getShelfBooksServerFn`).

Server function input is decoded with `validateInput(schema)` (`src/shared/server/`), not an identity cast. Where a shape belongs to a service, define the Schema in the service and derive the TypeScript type from it.

Queue handlers decide ack/retry with `queueOutcomeForExit` (`src/shared/queue/`): expected failures and timeouts are acked and recorded as failed jobs; defects are left unacked so Cloudflare redelivers them into the DLQ. Never blanket-ack.

Use `Effect.log*` for diagnostics — there should be no `console.*` in `src/`. Best-effort work that swallows its error must still `tapErrorCause(Effect.logError)` first. Read time from `Clock` (see `shared/lib/staleWindow.ts`), not `Date.now()`. Give every `Effect.forEach` an explicit concurrency bound.

### Database

Single schema file: `src/shared/db/schema.ts` (Drizzle + Cloudflare D1/SQLite). Kept centralized because relations span features.

Key domain tables: `books`, `book_files`, `tags`, `series`, `publishers`, `identifiers`, `comments`, `shelves`, `shelf_books`, `shelf_members`, `conversion_jobs`, `metadata_jobs`, `upload_tasks`.

Kobo-specific tables: `kobo_auth_tokens`, `kobo_synced_books`, `kobo_reading_states`, `kobo_bookmarks`, `kobo_statistics`, `kobo_api_logs`.

Auth tables (managed by Better Auth): `user`, `session`, `account`, `verification`.

Better Auth's `drizzleAdapter` needs a plain drizzle client and cannot go through `DatabaseContext`. That client is scoped to `src/shared/auth/auth.ts` on purpose — do not reintroduce a shared general-purpose drizzle instance. All other database access goes through a service.

### Background jobs

Two queues:
- `calibre-conversion` → `src/features/conversion/queue/conversion.ts` — format conversion via `ConverterContainer`
- `calibre-metadata` → `src/features/books/queue/metadata.ts` — EPUB metadata extraction

### Kobo sync

`src/features/kobo/` implements the Kobo sync API. Kobo devices send requests with double slashes and non-standard `accept` headers; `src/index.ts` normalizes these before they reach TanStack Start.

- `lib/kobo.server.ts` — pure protocol code: error classes, Schema encoders, response builders, body parsers. **Must not import a runtime or `AppLayer`**; `KoboService` imports this module, so a runtime import here would create a cycle.
- `services/KoboService.ts` — sync, metadata, reading state, tags.
- `server/withKoboAuth.ts` — the request boundary: auth-token resolution, API logging, and the wrapper every Kobo route uses.
- `server/kobo.ts` — token management server functions for the settings page.

### Go converter

`src/containers/converter/` — Go binary built by `Dockerfile`. Runs as a Cloudflare Container (Durable Object). Supports `epub`, `kepub`, `azw3`, `mobi`. Run converter tests when changing Go code, Dockerfile, or stream/format logic.

### Integration tests

`pnpm test` runs Vitest under `@cloudflare/vitest-pool-workers` (config: `vitest.config.ts`), executing tests inside `workerd` with real local Miniflare bindings (D1 + R2 + queues). Because services read bindings via `env` from `cloudflare:workers`, the production Effect layers (`AppLayer`) run unchanged in tests.

- Service tests live in `src/features/<feature>/tests/*.test.ts`; shared infrastructure tests live in `src/shared/tests/`.
- `src/shared/test/helpers.ts` exposes `runTest` / `runTestExit` (provide `AppLayer` + a fake converter layer) plus `seedUser`/`seedBook`/`seedBookFile`. These deliberately use per-call `Effect.provide`, not a shared `ManagedRuntime`: `isolatedStorage` tears storage down between tests, and a D1 client outliving that boundary intermittently stalls a later test.
- Error assertions match tag names as strings (`toContain("BookNotFound")`), so **renaming a tagged error silently breaks tests** — check before renaming.
- The suite has a known intermittent timeout that predates the Effect refactor and reproduces on an unmodified `main`; a single red run is not necessarily your change.
- `src/shared/test/apply-migrations.ts` applies `migrations/` to the local D1 before the suite; `isolatedStorage` resets D1/R2 per test.
- Bindings are configured explicitly in `vitest.config.ts` (not imported from `wrangler.jsonc`) so Miniflare never tries to build the Docker-backed `ConverterContainer`. Container-dependent paths use the fake converter layer.

### UI components

shadcn/ui components in `src/components/ui/`. Add new components with:

```bash
pnpm dlx shadcn@latest add <component>
```

## Conventions

- **Import alias**: use `#/*` for `src/*` (e.g., `import { foo } from "#/lib/utils"`)
- **Formatter/linter**: Biome — tabs, double quotes
- **Services**: `PascalCase.ts` filenames
- **Commits**: Conventional Commits — `type(scope): summary` (scopes: `kobo`, `converter`, `upload`, `wrangler`, etc.)
- **Secrets**: `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` via `.dev.vars` locally, Cloudflare dashboard in production
