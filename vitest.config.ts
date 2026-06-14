import path from "node:path";
import {
	defineWorkersConfig,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Standalone Vitest config for integration tests. Intentionally separate from
// vite.config.ts: the TanStack Start / Cloudflare Vite plugins cannot load
// inside the workerd test pool. Bindings are configured explicitly here (rather
// than importing wrangler.jsonc) so Miniflare never tries to build the
// Docker-backed ConverterContainer durable object, which it cannot do.
export default defineWorkersConfig(async () => {
	const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

	return {
		plugins: [tsconfigPaths()],
		test: {
			include: ["src/**/*.test.ts"],
			setupFiles: ["./src/shared/test/apply-migrations.ts"],
			poolOptions: {
				workers: {
					singleWorker: true,
					isolatedStorage: true,
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
							TEST_MIGRATIONS: migrations,
							BETTER_AUTH_URL: "http://localhost:8787",
							BETTER_AUTH_SECRET: "test-secret-do-not-use-in-prod",
						},
					},
				},
			},
		},
	};
});
