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

interface ContainerStreamResult {
	body: ReadableStream<Uint8Array>;
	contentType: string;
	size: number;
}

interface ConverterContainerService {
	process(
		body: ReadableStream,
		options: ContainerProcessOptions,
	): Effect.Effect<ContainerStreamResult, ConversionError>;
	convert(
		body: ReadableStream,
		formatFrom: string,
		formatTo: string,
	): Effect.Effect<ContainerStreamResult, ConversionError>;
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

// ---------------------------------------------------------------------------
// Streaming multipart builder — avoids buffering large files in Worker memory
// ---------------------------------------------------------------------------

type MultipartPart =
	| { type: "field"; name: string; value: string }
	| {
			type: "file";
			name: string;
			filename: string;
			body: ReadableStream | ArrayBuffer;
			contentType?: string;
	  };

function buildMultipartStream(parts: MultipartPart[]): {
	body: ReadableStream<Uint8Array>;
	contentType: string;
} {
	const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
	const encoder = new TextEncoder();

	const { readable, writable } = new TransformStream<Uint8Array>();

	(async () => {
		const writer = writable.getWriter();
		try {
			for (const part of parts) {
				if (part.type === "field") {
					await writer.write(
						encoder.encode(
							`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
						),
					);
				} else {
					const ct = part.contentType ?? "application/octet-stream";
					await writer.write(
						encoder.encode(
							`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${ct}\r\n\r\n`,
						),
					);

					if (part.body instanceof ArrayBuffer) {
						await writer.write(new Uint8Array(part.body));
					} else {
						const reader = (
							part.body as ReadableStream<Uint8Array>
						).getReader();
						for (;;) {
							const { done, value } = await reader.read();
							if (done) break;
							await writer.write(value);
						}
					}

					await writer.write(encoder.encode("\r\n"));
				}
			}
			await writer.write(encoder.encode(`--${boundary}--\r\n`));
			await writer.close();
		} catch (err) {
			await writer.abort(err instanceof Error ? err : new Error(String(err)));
		}
	})();

	return {
		body: readable,
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

// ---------------------------------------------------------------------------
// Ensure a container stub is ready before streaming the (single-use) body.
// ---------------------------------------------------------------------------

const getReadyStub = () =>
	Effect.tryPromise({
		try: async () => {
			const stub = await getRandom(env.CONVERTER, 5);
			const res = await stub.fetch(new Request("http://converter/health"));
			if (!res.ok)
				throw new Error(`Container health check failed: ${res.status}`);
			return stub;
		},
		catch: (cause) => new ConversionError({ cause }),
	}).pipe(
		Effect.retry(
			Schedule.exponential(Duration.seconds(2)).pipe(
				Schedule.compose(Schedule.recurs(5)),
			),
		),
	);

// ---------------------------------------------------------------------------
// Container RPC helpers (streaming — no ArrayBuffer buffering in the Worker)
// ---------------------------------------------------------------------------

const parseStreamResult = async (
	response: Response,
): Promise<ContainerStreamResult> => {
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Container request failed (${response.status}): ${errorText}`,
		);
	}

	if (!response.body) {
		throw new Error("Container returned an empty response body");
	}

	return {
		body: response.body,
		contentType:
			response.headers.get("content-type") ?? "application/octet-stream",
		size: Number(response.headers.get("content-length") ?? 0),
	};
};

const processInContainer = (
	fileBody: ReadableStream,
	options: ContainerProcessOptions,
): Effect.Effect<ContainerStreamResult, ConversionError> =>
	Effect.gen(function* () {
		const stub = yield* getReadyStub();

		return yield* Effect.tryPromise({
			try: async () => {
				const parts: MultipartPart[] = [
					{ type: "field", name: "format_from", value: options.formatFrom },
					{ type: "field", name: "format_to", value: options.formatTo },
				];

				if (options.metadata) {
					parts.push({
						type: "field",
						name: "metadata",
						value: JSON.stringify(options.metadata),
					});
				}

				parts.push({
					type: "file",
					name: "file",
					filename: `input.${options.formatFrom}`,
					body: fileBody,
				});

				if (options.cover) {
					parts.push({
						type: "file",
						name: "cover",
						filename: coverFileNameForContentType(options.cover.contentType),
						body: options.cover.bytes,
						contentType:
							options.cover.contentType ?? "application/octet-stream",
					});
				}

				const { body, contentType } = buildMultipartStream(parts);

				const response = await stub.fetch(
					new Request("http://converter/process", {
						method: "POST",
						body,
						// Required by Fetch spec for streaming request bodies
						// @ts-expect-error -- not yet in all TS lib types
						duplex: "half",
						headers: { "Content-Type": contentType },
					}),
				);

				return parseStreamResult(response);
			},
			catch: (cause) => new ConversionError({ cause }),
		});
	});

const convertInContainer = (
	fileBody: ReadableStream,
	formatFrom: string,
	formatTo: string,
): Effect.Effect<ContainerStreamResult, ConversionError> =>
	Effect.gen(function* () {
		const stub = yield* getReadyStub();

		return yield* Effect.tryPromise({
			try: async () => {
				const parts: MultipartPart[] = [
					{ type: "field", name: "format_from", value: formatFrom },
					{ type: "field", name: "format_to", value: formatTo },
					{
						type: "file",
						name: "file",
						filename: `input.${formatFrom}`,
						body: fileBody,
					},
				];

				const { body, contentType } = buildMultipartStream(parts);

				const response = await stub.fetch(
					new Request("http://converter/convert", {
						method: "POST",
						body,
						// Required by Fetch spec for streaming request bodies
						// @ts-expect-error -- not yet in all TS lib types
						duplex: "half",
						headers: { "Content-Type": contentType },
					}),
				);

				return parseStreamResult(response);
			},
			catch: (cause) => new ConversionError({ cause }),
		});
	});

export const ConverterContainerLive = Layer.succeed(ConverterContainerContext, {
	process: processInContainer,
	convert: convertInContainer,
});
