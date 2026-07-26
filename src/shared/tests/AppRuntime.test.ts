import { Data, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { QueueRuntime, ServerRuntime } from "#/shared/layers/AppRuntime";
import { ConverterContainerContext } from "#/shared/layers/ConverterContainerLayer";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";
import { R2Context } from "#/shared/layers/R2Layer";

class ProbeError extends Data.TaggedError("ProbeError")<{
	readonly detail: string;
}> {}

describe("AppRuntime", () => {
	describe("ServerRuntime", () => {
		it("builds the layer once and reuses it across separate runs", async () => {
			const [firstDb, firstR2] = await ServerRuntime.runPromise(
				Effect.all([DatabaseContext, R2Context]),
			);
			const [secondDb, secondR2] = await ServerRuntime.runPromise(
				Effect.all([DatabaseContext, R2Context]),
			);

			// Per-call `Effect.provide(AppLayer)` would hand back a fresh D1Client on
			// every run; a memoized runtime hands back the same instance.
			expect(secondDb).toBe(firstDb);
			expect(secondR2).toBe(firstR2);
		});

		it("stays usable for real queries after the first run", async () => {
			const runCount = Effect.gen(function* () {
				const database = yield* DatabaseContext;
				return yield* database.run("select 1 as one");
			});

			await ServerRuntime.runPromise(runCount);
			await ServerRuntime.runPromise(runCount);
		});

		it("serves concurrent runs from the same build", async () => {
			const instances = await Promise.all(
				Array.from({ length: 10 }, () =>
					ServerRuntime.runPromise(DatabaseContext),
				),
			);

			for (const instance of instances) {
				expect(instance).toBe(instances[0]);
			}
		});

		it("preserves the failure cause instead of swallowing it", async () => {
			const exit = await ServerRuntime.runPromiseExit(
				Effect.fail(new ProbeError({ detail: "boom" })),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(Exit.causeOption(exit))).toContain("ProbeError");
			}
		});

		it("preserves defects instead of converting them to failures", async () => {
			const exit = await ServerRuntime.runPromiseExit(
				Effect.die(new Error("unexpected")),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(Exit.causeOption(exit))).toContain("Die");
			}
		});
	});

	describe("QueueRuntime", () => {
		it("additionally provides the converter container", async () => {
			const container = await QueueRuntime.runPromise(
				ConverterContainerContext,
			);

			expect(typeof container.convert).toBe("function");
			expect(typeof container.process).toBe("function");
		});

		it("builds its layer once and reuses it across separate runs", async () => {
			const first = await QueueRuntime.runPromise(DatabaseContext);
			const second = await QueueRuntime.runPromise(DatabaseContext);

			expect(second).toBe(first);
		});
	});
});
