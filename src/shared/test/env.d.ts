import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// Pool v0.18 dropped `ProvidedEnv` from the `cloudflare:test` module; `env` is
// now typed as `Cloudflare.Env`, the same namespace `wrangler types` generates.
// So the test-only migrations binding declared in vitest.config.ts is declared
// against that namespace instead.
declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}
