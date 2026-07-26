import { Duration, Effect, TestClock, TestContext } from "effect";
import { describe, expect, it } from "vitest";
import { staleBefore } from "#/shared/lib/staleWindow";

const runWithClock = <A, E>(effect: Effect.Effect<A, E, never>) =>
	Effect.runPromise(Effect.provide(effect, TestContext.TestContext));

describe("staleBefore", () => {
	it("reads the current time from the Clock service, not Date.now", async () => {
		const cutoff = await runWithClock(
			Effect.gen(function* () {
				yield* TestClock.setTime(1_000_000);
				return yield* staleBefore(Duration.minutes(45));
			}),
		);

		expect(cutoff.getTime()).toBe(1_000_000 - 45 * 60 * 1000);
	});

	it("moves with the clock", async () => {
		const [first, second] = await runWithClock(
			Effect.gen(function* () {
				yield* TestClock.setTime(0);
				const before = yield* staleBefore(Duration.minutes(1));
				yield* TestClock.adjust(Duration.minutes(10));
				const after = yield* staleBefore(Duration.minutes(1));
				return [before, after] as const;
			}),
		);

		expect(second.getTime() - first.getTime()).toBe(10 * 60 * 1000);
	});

	it("returns the current instant for a zero window", async () => {
		const cutoff = await runWithClock(
			Effect.gen(function* () {
				yield* TestClock.setTime(5_000);
				return yield* staleBefore(Duration.zero);
			}),
		);

		expect(cutoff.getTime()).toBe(5_000);
	});
});
