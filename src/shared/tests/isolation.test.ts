import { env } from "cloudflare:test";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as schema from "#/shared/db/schema";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";
import { R2Context } from "#/shared/layers/R2Layer";
import { runTest, seedBook } from "#/shared/test/helpers";

// Per-test storage isolation is a load-bearing assumption for the whole suite:
// every service test seeds its own rows and asserts on counts or lookups without
// cleaning up. If isolation regresses, the symptom is intermittent, unrelated
// assertion failures that look like flakiness rather than a broken contract.
//
// These tests pin the contract explicitly. `LEAKED_*` are written by one test
// and must be invisible to the next.
const LEAKED_BOOK_ID = "isolation-probe-book";
const LEAKED_R2_KEY = "isolation-probe/object.bin";

const countProbeBooks = Effect.gen(function* () {
	const database = yield* DatabaseContext;
	const rows = yield* database
		.select({ id: schema.books.id })
		.from(schema.books);
	return rows.filter((row) => row.id === LEAKED_BOOK_ID).length;
});

const readProbeObject = Effect.gen(function* () {
	const storage = yield* R2Context;
	return yield* Effect.promise(() => storage.get(LEAKED_R2_KEY));
});

describe("per-test storage isolation", () => {
	it("writes a D1 row and an R2 object", async () => {
		await runTest(
			Effect.gen(function* () {
				const storage = yield* R2Context;
				yield* seedBook({ id: LEAKED_BOOK_ID, title: "Isolation Probe" });
				yield* Effect.promise(() =>
					storage.put(LEAKED_R2_KEY, new Uint8Array([1, 2, 3])),
				);
			}),
		);

		expect(await runTest(countProbeBooks)).toBe(1);
		expect(await runTest(readProbeObject)).not.toBeNull();
	});

	it("does not see the D1 row written by the previous test", async () => {
		expect(await runTest(countProbeBooks)).toBe(0);
	});

	it("does not see the R2 object written by the previous test", async () => {
		expect(await runTest(readProbeObject)).toBeNull();
	});

	it("still sees the migrated schema after isolation resets", async () => {
		// The reset must roll back per-test writes without discarding the
		// migrations applied in the suite-level setup.
		const rows = await runTest(
			Effect.gen(function* () {
				const database = yield* DatabaseContext;
				return yield* database
					.select({ id: schema.books.id })
					.from(schema.books);
			}),
		);

		expect(Array.isArray(rows)).toBe(true);
	});

	it("exposes the same bindings the services use", () => {
		expect(env.DB).toBeDefined();
		expect(env.BOOKS_STORAGE).toBeDefined();
	});
});
