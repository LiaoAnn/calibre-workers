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
	cancel(cause?: unknown): Promise<void>;
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

function buildMultipartStream(
	parts: MultipartPart[],
	signal: AbortSignal,
): {
	body: ReadableStream<Uint8Array>;
	contentType: string;
} {
	const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
	const encoder = new TextEncoder();

	const { readable, writable } = new TransformStream<Uint8Array>();

	// The pump runs outside the fibre that started it, so without the signal an
	// interrupted or timed-out conversion would leave it draining the R2 body
	// into a stream nobody reads. The caller aborts the signal on interrupt.
	(async () => {
		const writer = writable.getWriter();
		try {
			for (const part of parts) {
				signal.throwIfAborted();
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
						try {
							for (;;) {
								signal.throwIfAborted();
								const { done, value } = await reader.read();
								if (done) break;
								await writer.write(value);
							}
						} finally {
							reader.releaseLock();
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

const HEALTH_CHECK_TIMEOUT = Duration.seconds(10);
const CONTAINER_REQUEST_TIMEOUT = Duration.minutes(8);

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
		// Bound each attempt: a container that accepts the connection but never
		// answers would otherwise hold the retry schedule open indefinitely.
		Effect.timeoutFail({
			duration: HEALTH_CHECK_TIMEOUT,
			onTimeout: () =>
				new ConversionError({ cause: "container health check timed out" }),
		}),
		Effect.retry(
			Schedule.exponential(Duration.seconds(2)).pipe(
				Schedule.compose(Schedule.recurs(5)),
			),
		),
	);

// ---------------------------------------------------------------------------
// Container RPC helpers (streaming — no ArrayBuffer buffering in the Worker)
// ---------------------------------------------------------------------------

const restoreFixedLength = (
	body: ReadableStream<Uint8Array>,
	size: number,
): Pick<ContainerStreamResult, "body" | "cancel"> => {
	const fixedLength = new FixedLengthStream(size);
	const reader = body.getReader();
	const writer = fixedLength.writable.getWriter();
	let completed = false;
	let cancellation: Promise<void> | undefined;

	const cancel = (cause?: unknown) => {
		if (completed) return Promise.resolve();
		if (cancellation) return cancellation;

		cancellation = Promise.allSettled([
			Promise.resolve().then(() => reader.cancel(cause)),
			Promise.resolve().then(() => writer.abort(cause)),
		]).then(() => undefined);
		return cancellation;
	};

	// workerd cannot pipe one identity transform directly into another, so bridge
	// them manually. Awaiting each write preserves backpressure. Consumers use
	// the explicit cancel contract because FixedLengthStream does not expose
	// readable-side cancellation to its writer while a source read is pending.
	void (async () => {
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				await writer.write(value);
			}
			await writer.close();
		} catch (cause) {
			await cancel(cause);
		} finally {
			if (cancellation) await cancellation;
			completed = true;
			reader.releaseLock();
			writer.releaseLock();
		}
	})();

	return { body: fixedLength.readable, cancel };
};

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

	const contentLength = response.headers.get("content-length");
	const size = Number(contentLength);
	if (
		contentLength === null ||
		!/^\d+$/.test(contentLength) ||
		!Number.isSafeInteger(size)
	) {
		const lengthError = new Error(
			`Container returned an invalid Content-Length: ${contentLength ?? "missing"}`,
		);
		try {
			await response.body.cancel();
		} catch (cause) {
			throw new AggregateError(
				[lengthError, cause],
				"Container returned an invalid Content-Length and its body could not be cancelled",
			);
		}
		throw lengthError;
	}

	return {
		...restoreFixedLength(response.body, size),
		contentType:
			response.headers.get("content-type") ?? "application/octet-stream",
		size,
	};
};

const requestContainer = (
	path: string,
	parts: MultipartPart[],
): Effect.Effect<ContainerStreamResult, ConversionError> =>
	Effect.gen(function* () {
		const stub = yield* getReadyStub();

		return yield* Effect.suspend(() => {
			// One controller drives both the multipart pump and the fetch, so an
			// interrupt or a timeout stops reading R2 instead of leaving a detached
			// promise writing into a stream nobody consumes.
			const controller = new AbortController();

			return Effect.tryPromise({
				try: async () => {
					const { body, contentType } = buildMultipartStream(
						parts,
						controller.signal,
					);

					const response = await stub.fetch(
						new Request(`http://converter${path}`, {
							method: "POST",
							body,
							// Required by Fetch spec for streaming request bodies
							// @ts-expect-error -- not yet in all TS lib types
							duplex: "half",
							headers: { "Content-Type": contentType },
							signal: controller.signal,
						}),
					);

					return await parseStreamResult(response);
				},
				catch: (cause) => new ConversionError({ cause }),
			}).pipe(
				Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
				Effect.timeoutFail({
					duration: CONTAINER_REQUEST_TIMEOUT,
					onTimeout: () =>
						new ConversionError({ cause: `container ${path} timed out` }),
				}),
			);
		});
	});

const processInContainer = (
	fileBody: ReadableStream,
	options: ContainerProcessOptions,
): Effect.Effect<ContainerStreamResult, ConversionError> => {
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
			contentType: options.cover.contentType ?? "application/octet-stream",
		});
	}

	return requestContainer("/process", parts);
};

const convertInContainer = (
	fileBody: ReadableStream,
	formatFrom: string,
	formatTo: string,
): Effect.Effect<ContainerStreamResult, ConversionError> =>
	requestContainer("/convert", [
		{ type: "field", name: "format_from", value: formatFrom },
		{ type: "field", name: "format_to", value: formatTo },
		{
			type: "file",
			name: "file",
			filename: `input.${formatFrom}`,
			body: fileBody,
		},
	]);

export const ConverterContainerLive = Layer.succeed(ConverterContainerContext, {
	process: processInContainer,
	convert: convertInContainer,
});
