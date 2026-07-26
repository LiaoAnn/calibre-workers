import path from "node:path";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Standalone Vitest config for integration tests. Intentionally separate from
// vite.config.ts: the TanStack Start / Cloudflare Vite plugins cannot load
// inside the workerd test pool. Bindings are configured explicitly here (rather
// than importing wrangler.jsonc) so Miniflare never tries to build the
// Docker-backed ConverterContainer durable object, which it cannot do.
//
// Since pool v0.18 the worker pool is a Vite plugin rather than a config
// wrapper, and `isolatedStorage` / `singleWorker` are gone. Per-test isolation
// is now explicit — see `src/shared/test/apply-migrations.ts`.
export default defineConfig({
	plugins: [
		tsconfigPaths(),
		cloudflareTest(async () => ({
			miniflare: {
				compatibilityDate: "2025-09-02",
				compatibilityFlags: ["nodejs_compat"],
				d1Databases: { DB: "calibre-workers-test" },
				r2Buckets: ["BOOKS_STORAGE"],
				queueProducers: {
					CONVERSION_QUEUE: "calibre-conversion",
					METADATA_QUEUE: "calibre-metadata",
				},
				bindings: {
					// Surfaced to the migration setup file via cloudflare:test env.
					TEST_MIGRATIONS: await readD1Migrations(
						path.join(__dirname, "migrations"),
					),
					BETTER_AUTH_URL: "http://localhost:8787",
					BETTER_AUTH_SECRET: "test-secret-do-not-use-in-prod",
				},
			},
		})),
	],
	test: {
		include: ["src/**/*.test.ts"],
		setupFiles: ["./src/shared/test/apply-migrations.ts"],
	},
});
