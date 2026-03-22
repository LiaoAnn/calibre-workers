import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";
import { getContainer } from "@cloudflare/containers";
import { Context, Data, Duration, Effect, Layer, Schedule } from "effect";

export class ConversionError extends Data.TaggedError("ConversionError")<{
	readonly cause: unknown;
}> {}

export interface ContainerProcessOptions {
	formatFrom: string;
	formatTo: string;
	metadata?: {
		title?: string;
		authors?: string[];
		language?: string;
		publisher?: string;
	};
}

export interface ContainerProcessResult {
	bytes: ArrayBuffer;
	contentType: string;
}

export interface ConverterContainerService {
	process(
		bytes: ArrayBuffer,
		options: ContainerProcessOptions,
	): Effect.Effect<ContainerProcessResult, ConversionError>;
	convert(
		bytes: ArrayBuffer,
		formatFrom: string,
		formatTo: string,
	): Effect.Effect<ArrayBuffer, ConversionError>;
}

export class ConverterContainerContext extends Context.Tag(
	"ConverterContainerContext",
)<ConverterContainerContext, ConverterContainerService>() {}

const processInContainer = (
	bytes: ArrayBuffer,
	options: ContainerProcessOptions,
): Effect.Effect<ContainerProcessResult, ConversionError> =>
	Effect.tryPromise({
		try: async () => {
			// getContainer returns a singleton stub (uses 'cf-singleton-container' by default)
			const stub = getContainer(env.CONVERTER);

			const formData = new FormData();
			formData.append("file", new Blob([bytes]), `input.${options.formatFrom}`);
			formData.append("format_from", options.formatFrom);
			formData.append("format_to", options.formatTo);
			if (options.metadata) {
				formData.append("metadata", JSON.stringify(options.metadata));
			}

			// Container.fetch() forwards the request to the container at defaultPort (8080)
			const response = await stub.fetch(
				new Request("http://converter/process", {
					method: "POST",
					body: formData,
				}),
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Container conversion failed (${response.status}): ${errorText}`,
				);
			}

			return {
				bytes: await response.arrayBuffer(),
				contentType:
					response.headers.get("content-type") ?? "application/octet-stream",
			};
		},
		catch: (cause) => new ConversionError({ cause }),
	}).pipe(
		// Retry on "container port not found" or "Connection refused" errors typical during startup
		Effect.retry(
			Schedule.exponential(Duration.seconds(2)).pipe(
				Schedule.compose(Schedule.recurs(5)),
			),
		),
	);

const convertInContainer = (
	bytes: ArrayBuffer,
	formatFrom: string,
	formatTo: string,
): Effect.Effect<ArrayBuffer, ConversionError> =>
	Effect.tryPromise({
		try: async () => {
			const stub = getContainer(env.CONVERTER);

			const formData = new FormData();
			formData.append("file", new Blob([bytes]), `input.${formatFrom}`);
			formData.append("format_from", formatFrom);
			formData.append("format_to", formatTo);

			const response = await stub.fetch(
				new Request("http://converter/convert", {
					method: "POST",
					body: formData,
				}),
			);

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Container conversion failed (${response.status}): ${errorText}`,
				);
			}

			return response.arrayBuffer();
		},
		catch: (cause) => new ConversionError({ cause }),
	}).pipe(
		Effect.retry(
			Schedule.exponential(Duration.seconds(2)).pipe(
				Schedule.compose(Schedule.recurs(5)),
			),
		),
	);

export const ConverterContainerLive = Layer.succeed(ConverterContainerContext, {
	process: processInContainer,
	convert: convertInContainer,
});
