import { applyD1Migrations, env, reset } from "cloudflare:test";
import { beforeEach } from "vitest";

// Per-test isolation, and the migrated schema every test starts from.
//
// Pool v0.18 dropped the implicit `isolatedStorage` option in favour of an
// explicit `reset()`, which is more thorough than the old mechanism: it clears
// the database outright, migrations included. So the two have to happen
// together — reset, then re-apply — rather than migrating once in `beforeAll`.
//
// This preserves the contract every service test relies on: seed freely, never
// clean up. `src/shared/tests/isolation.test.ts` pins it.
beforeEach(async () => {
	await reset();
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
