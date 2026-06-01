# Repository Guidelines

## Project Structure & Module Organization

This is a Cloudflare Workers ebook app using React, TanStack Start, Effect, Drizzle, R2, D1, Queues, and Containers. TypeScript source lives in `src/`: routes in `src/routes/`, UI in `src/components/`, services in `src/services/`, layers in `src/layers/`, and schema in `src/db/`. Migrations live in `migrations/`, assets in `public/`, and the Go converter in `src/containers/converter/`.

## Build, Test, and Development Commands

Run this project inside the VS Code devcontainer defined by `.devcontainer/devcontainer.json` and `.devcontainer/docker-compose.yml`. The service is `app`; it runs as `node`, mounts the Docker socket for Cloudflare Containers, and forwards port `8787`.

From the host, do not run project commands directly unless already inside the devcontainer. First find the running container, then execute in it:

- `docker compose -f .devcontainer/docker-compose.yml ps`: find the service.
- `docker compose -f .devcontainer/docker-compose.yml exec app pnpm dev`: run dev server in `app`.
- `docker compose -f .devcontainer/docker-compose.yml exec app pnpm check`: run checks through `app`.

Avoid creating a new container unless necessary. Inside the container, use:

- `pnpm dev`: start Vite/Wrangler on `http://localhost:8787`.
- `pnpm build`: build the app for deployment.
- `pnpm test`: run Vitest tests, when present.
- `pnpm test:converter`: run Go converter unit tests.
- `pnpm check`: run Biome formatting and lint checks.
- `pnpm knip`: detect unused exports, files, and packages.
- `pnpm typecheck`: run TypeScript type checking.
- `pnpm db:generate`: generate Drizzle migrations from `src/db/schema.ts`.
- `pnpm db:apply`: apply D1 migrations.

## Required Final Checks

After every coding task, run these inside the active devcontainer before reporting completion:

- `pnpm check`: verify formatting and linting with Biome.
- `pnpm knip`: keep unused exports and packages out of the codebase.
- `pnpm typecheck`: verify TypeScript types.

If `pnpm check` reports issues Biome can fix automatically, run `pnpm exec biome check --write .` and then rerun `pnpm check`. Do not hand-edit formatting-only or auto-fixable Biome findings.

## Coding Style & Naming Conventions

Biome is the formatter and linter. It uses tabs and double quotes for JavaScript/TypeScript. Run `pnpm format`, `pnpm lint`, or `pnpm check` before submitting changes. Prefer the `#/*` alias for `src/*` imports. Do not manually edit `src/routeTree.gen.ts`. Route files follow TanStack Router naming; services use `PascalCase`, such as `BookService.ts`.

## Testing Guidelines

Current tests focus on the Go converter in `src/containers/converter/`. Unit tests use Go’s `*_test.go` naming; integration tests use the `integration` build tag. Run converter tests when editing conversion logic, Dockerfile behavior, streams, or supported formats. Add Vitest coverage for TypeScript logic when practical.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commit style, for example `fix(kobo): can't re-download deleted books`. Use `type(scope): summary`, with scopes such as `kobo`, `converter`, `upload`, or `wrangler`. PRs should include the problem, summary, tests run, linked issues, and screenshots for UI changes.

## Security & Configuration Tips

Do not commit secrets. Configure `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` through Cloudflare or local Wrangler config. Treat R2, D1, queue, and container settings in `wrangler.jsonc` as deployment-sensitive.
