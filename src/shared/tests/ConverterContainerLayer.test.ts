import { Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ConverterContainerContext,
	ConverterContainerLive,
} from "#/shared/layers/ConverterContainerLayer";
import { R2Context } from "#/shared/layers/R2Layer";
import { runTest } from "#/shared/test/helpers";

const containerMock = vi.hoisted(() => ({
	cancelled: false,
	scenario: "valid" as
		| "cancel"
		| "invalid-length"
		| "missing-length"
		| "short-body"
		| "valid",
}));

vi.mock("@cloudflare/containers", () => ({
	getRandom: async () => ({
		fetch: async (request: Request) => {
			const url = new URL(request.url);
			if (url.pathname === "/health") {
				return new Response("ok");
			}

			await request.arrayBuffer();

			const bytes = new TextEncoder().encode("processed-bytes");
			const source = new ReadableStream<Uint8Array>({
				start(controller) {
					if (containerMock.scenario !== "cancel") {
						controller.enqueue(bytes);
					}
					if (
						containerMock.scenario === "short-body" ||
						containerMock.scenario === "valid"
					) {
						controller.close();
					}
				},
				cancel() {
					containerMock.cancelled = true;
				},
			});
			const headers = new Headers({
				"Content-Type": "application/epub+zip",
			});
			if (containerMock.scenario === "invalid-length") {
				headers.set("Content-Length", "12.5");
			}
			if (
				containerMock.scenario === "cancel" ||
				containerMock.scenario === "valid"
			) {
				headers.set("Content-Length", String(bytes.byteLength));
			}
			if (containerMock.scenario === "short-body") {
				headers.set("Content-Length", String(bytes.byteLength + 1));
			}
			if (containerMock.scenario === "valid") {
				const { readable, writable } = new IdentityTransformStream();
				void source.pipeTo(writable).catch(() => undefined);
				return new Response(readable, { headers });
			}

			return new Response(source, { headers });
		},
	}),
}));

const streamOf = (value: string) => {
	const bytes = new TextEncoder().encode(value);
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
};

describe("ConverterContainerLayer", () => {
	beforeEach(() => {
		containerMock.cancelled = false;
		containerMock.scenario = "valid";
	});

	it("restores a known length before a container response is uploaded to R2", async () => {
		const converter = await Effect.runPromise(
			Effect.provide(ConverterContainerContext, ConverterContainerLive),
		);
		const processed = await Effect.runPromise(
			converter.process(streamOf("source"), {
				formatFrom: "epub",
				formatTo: "epub",
			}),
		);

		const stored = await runTest(
			Effect.gen(function* () {
				const storage = yield* R2Context;
				yield* Effect.promise(() =>
					storage.put("converter/processed.epub", processed.body),
				);
				const object = yield* Effect.promise(() =>
					storage.get("converter/processed.epub"),
				);
				return object ? yield* Effect.promise(() => object.text()) : undefined;
			}),
		);

		expect(stored).toBe("processed-bytes");
	});

	it.each(["missing-length", "invalid-length"] as const)(
		"rejects and cancels a container response with %s",
		async (scenario) => {
			containerMock.scenario = scenario;
			const converter = await Effect.runPromise(
				Effect.provide(ConverterContainerContext, ConverterContainerLive),
			);

			const exit = await Effect.runPromiseExit(
				converter.process(streamOf("source"), {
					formatFrom: "epub",
					formatTo: "epub",
				}),
			);
			if (Exit.isSuccess(exit)) {
				await exit.value.body.cancel();
			}

			expect(Exit.isFailure(exit)).toBe(true);
			await vi.waitFor(() => expect(containerMock.cancelled).toBe(true));
		},
	);

	it("rejects an upload when the container body is shorter than declared", async () => {
		containerMock.scenario = "short-body";
		const converter = await Effect.runPromise(
			Effect.provide(ConverterContainerContext, ConverterContainerLive),
		);
		const processed = await Effect.runPromise(
			converter.process(streamOf("source"), {
				formatFrom: "epub",
				formatTo: "epub",
			}),
		);

		await expect(
			runTest(
				Effect.gen(function* () {
					const storage = yield* R2Context;
					yield* Effect.promise(() =>
						storage.put("converter/short.epub", processed.body),
					);
				}),
			),
		).rejects.toThrow();

		const object = await runTest(
			Effect.gen(function* () {
				const storage = yield* R2Context;
				return yield* Effect.promise(() => storage.get("converter/short.epub"));
			}),
		);
		expect(object).toBeNull();
	});

	it("propagates downstream cancellation before the first container chunk", async () => {
		containerMock.scenario = "cancel";
		const converter = await Effect.runPromise(
			Effect.provide(ConverterContainerContext, ConverterContainerLive),
		);
		const processed = await Effect.runPromise(
			converter.process(streamOf("source"), {
				formatFrom: "epub",
				formatTo: "epub",
			}),
		);

		await processed.cancel(new Error("downstream cancelled"));

		await vi.waitFor(() => expect(containerMock.cancelled).toBe(true));
	});
});
