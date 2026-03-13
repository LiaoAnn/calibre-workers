import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";
import { getContainer } from "@cloudflare/containers";
import { Context, Data, Duration, Effect, Layer, Schedule } from "effect";

export class ConversionError extends Data.TaggedError("ConversionError")<{
	readonly cause: unknown;
}> {}

export interface ConverterContainerService {
	convert(
		bytes: ArrayBuffer,
		formatFrom: string,
		formatTo: string,
	): Effect.Effect<ArrayBuffer, ConversionError>;
}

export class ConverterContainerContext extends Context.Tag(
	"ConverterContainerContext",
)<ConverterContainerContext, ConverterContainerService>() {}

export const ConverterContainerLive = Layer.succeed(ConverterContainerContext, {
	convert: (bytes: ArrayBuffer, formatFrom: string, formatTo: string) =>
		Effect.tryPromise({
			try: async () => {
				// getContainer returns a singleton stub (uses 'cf-singleton-container' by default)
				const stub = getContainer(env.CONVERTER);

				const formData = new FormData();
				formData.append("file", new Blob([bytes]), `input.${formatFrom}`);
				formData.append("format_from", formatFrom);
				formData.append("format_to", formatTo);

				// Container.fetch() forwards the request to the container at defaultPort (8080)
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

				return await response.arrayBuffer();
			},
			catch: (cause) => new ConversionError({ cause }),
		}).pipe(
			// Retry on "container port not found" or "Connection refused" errors typical during startup
			Effect.retry(
				Schedule.exponential(Duration.seconds(2)).pipe(
					Schedule.compose(Schedule.recurs(5)),
				),
			),
		),
});
