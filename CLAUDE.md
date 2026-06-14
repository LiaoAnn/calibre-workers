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

### Request flow

`src/index.ts` is the Worker entrypoint. It exports:
- `default.fetch` — forwards to TanStack Start SSR server, with special Kobo request normalization (duplicate slashes and non-HTML `accept` headers)
- `default.queue` — routes `calibre-conversion` and `calibre-metadata` queues to handlers in `src/queue/`
- `default.scheduled` — cron handler (every 15 min) in `src/scheduled.ts`
- `ConverterContainer` — Durable Object backed by a Cloudflare Container (Go binary in `src/containers/converter/`)

### Frontend / routing

File-based routing via TanStack Router. Route files in `src/routes/` auto-generate `src/routeTree.gen.ts` — **never edit that file manually**.

### Server functions

`src/server/*.ts` files contain `createServerFn()` calls (TanStack Start). These run server-side and are the bridge between React routes and Effect services. One file per domain: `books.ts`, `files.ts`, `conversions.ts`, `kobo.ts`, `shelves.ts`, `tasks.ts`, `users.ts`, `autocomplete.ts`.

### Effect service layer

Business logic lives in `src/services/PascalCase.ts` and uses Effect for async + typed errors. Services receive dependencies (DB, R2) via Effect context.

Layers are composed in `src/layers/`:
- `DatabaseLive` — Drizzle + `@effect/sql-d1`
- `R2Live` — Cloudflare R2 bucket
- `ConverterContainerLive` — Durable Object proxy for converter

`AppLayer = merge(DatabaseLive, R2Live)` — used by most server functions.
`AppLayerWithContainer = merge(DatabaseLive, R2Live, ConverterContainerLive)` — used by the queue handler.

Pattern: server functions call `Effect.runPromise(someService(...).pipe(Effect.provide(AppLayer)))`.

### Database

Single schema file: `src/db/schema.ts` (Drizzle + Cloudflare D1/SQLite).

Key domain tables: `books`, `book_files`, `tags`, `series`, `publishers`, `identifiers`, `comments`, `shelves`, `shelf_books`, `shelf_members`, `conversion_jobs`, `metadata_jobs`, `upload_tasks`.

Kobo-specific tables: `kobo_auth_tokens`, `kobo_synced_books`, `kobo_reading_states`, `kobo_bookmarks`, `kobo_statistics`, `kobo_api_logs`.

Auth tables (managed by Better Auth): `user`, `session`, `account`, `verification`.

### Background jobs

Two queues:
- `calibre-conversion` → `src/queue/conversion.ts` — format conversion via `ConverterContainer`
- `calibre-metadata` → `src/queue/metadata.ts` — EPUB metadata extraction

### Kobo sync

`src/server/kobo.ts` + `src/services/KoboService.ts` implement the Kobo sync API. Kobo devices send requests with double slashes and non-standard `accept` headers; `src/index.ts` normalizes these before they reach TanStack Start.

### Go converter

`src/containers/converter/` — Go binary built by `Dockerfile`. Runs as a Cloudflare Container (Durable Object). Supports `epub`, `kepub`, `azw3`, `mobi`. Run converter tests when changing Go code, Dockerfile, or stream/format logic.

### Integration tests

`pnpm test` runs Vitest under `@cloudflare/vitest-pool-workers` (config: `vitest.config.ts`), executing tests inside `workerd` with real local Miniflare bindings (D1 + R2 + queues). Because services read bindings via `env` from `cloudflare:workers`, the production Effect layers (`AppLayer`) run unchanged in tests.

- Tests are colocated as `src/services/*.test.ts`.
- `src/test/helpers.ts` exposes `runTest` / `runTestExit` (provide `AppLayer` + a fake converter layer) plus `seedUser`/`seedBook`/`seedBookFile`.
- `src/test/apply-migrations.ts` applies `migrations/` to the local D1 before the suite; `isolatedStorage` resets D1/R2 per test.
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
