import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Apply the project's D1 migrations to the local Miniflare database once before
// the suite runs. With isolatedStorage enabled, this migrated schema becomes
// the seed each individual test starts from; per-test writes roll back after.
beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
