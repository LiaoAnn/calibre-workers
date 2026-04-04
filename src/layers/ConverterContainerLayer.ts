import "@tanstack/react-start/server-only";

import { env } from "cloudflare:workers";
import { getRandom } from "@cloudflare/containers";
import { Context, Data, Duration, Effect, Layer, Schedule } from "effect";

class ConversionError extends Data.TaggedError("ConversionError")<{
	readonly cause: unknown;
}> {}

interface ContainerProcessOptions {
	formatFrom: string;
	formatTo: string;
	metadata?: {
		title?: string;
		authors?: string[];
		language?: string;
		publisher?: string;
	};
	cover?: {
		bytes: ArrayBuffer;
		contentType?: string;
	};
}

interface ContainerProcessResult {
	bytes: ArrayBuffer;
	contentType: string;
}

interface ConverterContainerService {
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

const coverFileNameForContentType = (contentType?: string): string => {
	const mimeType = contentType?.split(";")[0]?.trim().toLowerCase();

	switch (mimeType) {
		case "image/jpeg":
		case "image/jpg":
		case "image/pjpeg":
			return "cover.jpg";
		case "image/png":
		case "image/x-png":
			return "cover.png";
		case "image/webp":
			return "cover.webp";
		case "image/gif":
			return "cover.gif";
		default:
			return "cover";
	}
};

const processInContainer = (
	bytes: ArrayBuffer,
	options: ContainerProcessOptions,
): Effect.Effect<ContainerProcessResult, ConversionError> =>
	Effect.tryPromise({
		try: async () => {
			const stub = await getRandom(env.CONVERTER, 5);

			const formData = new FormData();
			formData.append("file", new Blob([bytes]), `input.${options.formatFrom}`);
			formData.append("format_from", options.formatFrom);
			formData.append("format_to", options.formatTo);
			if (options.metadata) {
				formData.append("metadata", JSON.stringify(options.metadata));
			}
			if (options.cover) {
				formData.append(
					"cover",
					new Blob([options.cover.bytes], {
						type: options.cover.contentType ?? "application/octet-stream",
					}),
					coverFileNameForContentType(options.cover.contentType),
				);
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
			const stub = await getRandom(env.CONVERTER, 5);

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
