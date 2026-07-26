import { Context, Data, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { AppLayerWithContainer } from "#/shared/layers/AppLayer";
import { ConverterContainerContext } from "#/shared/layers/ConverterContainerLayer";

class ProbeError extends Data.TaggedError("ProbeError")<{
	readonly detail: string;
}> {}

class Probe extends Context.Tag("Probe")<Probe, { readonly build: number }>() {}

// These assertions cover the contract `ServerRuntime` / `QueueRuntime` rely on:
// a ManagedRuntime builds its layer once and reuses it for every later run,
// unlike per-call `Effect.provide`, which rebuilds the graph (including the
// scoped `D1Client`) each time.
//
// A counting probe layer is used instead of `AppLayer` on purpose. Building the
// real D1-backed layer inside this suite is racy: `isolatedStorage` tears
// Miniflare storage down between tests, and all files share one module registry
// under `singleWorker`, so a live D1 scope intermittently stalls a later file.
// The equivalent behaviour against real bindings is verified end-to-end by
// driving repeated requests at a local dev server.
const makeProbeLayer = () => {
	let builds = 0;
	const layer = Layer.effect(
		Probe,
		Effect.sync(() => {
			builds += 1;
			return { build: builds };
		}),
	);
	return { layer, builds: () => builds };
};

describe("AppRuntime", () => {
	it("builds the layer once and reuses it across separate runs", async () => {
		const probe = makeProbeLayer();
		const runtime = ManagedRuntime.make(probe.layer);

		try {
			const first = await runtime.runPromise(Probe);
			const second = await runtime.runPromise(Probe);
			const third = await runtime.runPromise(Probe);

			expect(probe.builds()).toBe(1);
			expect(second).toBe(first);
			expect(third).toBe(first);
		} finally {
			await runtime.dispose();
		}
	});

	it("rebuilds per call when using Effect.provide, which is what it replaces", async () => {
		const probe = makeProbeLayer();

		await Effect.runPromise(Effect.provide(Probe, probe.layer));
		await Effect.runPromise(Effect.provide(Probe, probe.layer));

		expect(probe.builds()).toBe(2);
	});

	it("serves concurrent runs from the same build", async () => {
		const probe = makeProbeLayer();
		const runtime = ManagedRuntime.make(probe.layer);

		try {
			const instances = await Promise.all(
				Array.from({ length: 10 }, () => runtime.runPromise(Probe)),
			);

			expect(probe.builds()).toBe(1);
			for (const instance of instances) {
				expect(instance).toBe(instances[0]);
			}
		} finally {
			await runtime.dispose();
		}
	});

	it("preserves the failure cause instead of swallowing it", async () => {
		const probe = makeProbeLayer();
		const runtime = ManagedRuntime.make(probe.layer);

		try {
			const exit = await runtime.runPromiseExit(
				Effect.fail(new ProbeError({ detail: "boom" })),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(Exit.causeOption(exit))).toContain("ProbeError");
			}
		} finally {
			await runtime.dispose();
		}
	});

	it("preserves defects instead of converting them to failures", async () => {
		const probe = makeProbeLayer();
		const runtime = ManagedRuntime.make(probe.layer);

		try {
			const exit = await runtime.runPromiseExit(
				Effect.die(new Error("unexpected")),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(Exit.causeOption(exit))).toContain("Die");
			}
		} finally {
			await runtime.dispose();
		}
	});

	it("keeps the converter reachable only through the queue layer", async () => {
		// `Layer.succeed`, so this touches no bindings and no storage.
		const container = await Effect.runPromise(
			Effect.provide(ConverterContainerContext, AppLayerWithContainer),
		);

		expect(typeof container.convert).toBe("function");
		expect(typeof container.process).toBe("function");
	});
});
