import "@tanstack/react-start/server-only";

import { Effect, Either } from "effect";
import { AppLayerWithContainer } from "#/layers/AppLayer";
import { ConverterContainerContext } from "#/layers/ConverterContainerLayer";
import { getBookMetadataForProcess } from "#/services/BookService";
import { getBookFile, uploadBookFile } from "#/services/FileService";

export interface MetadataQueueMessage {
	bookId: string;
	fileId: string;
	r2Key: string;
	format: string;
}

const METADATA_MAX_ATTEMPTS = 3;

function mimeTypeForFormat(format: string) {
	switch (format.toLowerCase()) {
		case "epub":
		case "kepub":
			return "application/epub+zip";
		case "mobi":
			return "application/x-mobipocket-ebook";
		case "azw3":
			return "application/vnd.amazon.mobi8-ebook";
		case "pdf":
			return "application/pdf";
		case "txt":
			return "text/plain; charset=utf-8";
		default:
			return "application/octet-stream";
	}
}

export const handleMetadataQueue: ExportedHandlerQueueHandler<
	Env,
	MetadataQueueMessage
> = async (batch, _env) => {
	for (const message of batch.messages) {
		const { bookId, fileId, r2Key, format } = message.body;

		const runnable = Effect.gen(function* () {
			const latestMetadata = yield* getBookMetadataForProcess(bookId);
			const source = yield* getBookFile(r2Key);

			const bytes = yield* Effect.tryPromise({
				try: () => source.arrayBuffer(),
				catch: (cause) =>
					new Error(
						`arrayBuffer failed for metadata sync ${fileId}: ${String(cause)}`,
					),
			});

			const container = yield* ConverterContainerContext;
			const processed = yield* container.process(bytes, {
				formatFrom: format,
				formatTo: format,
				metadata: latestMetadata,
			});

			yield* uploadBookFile({
				r2Key,
				body: processed.bytes,
				contentType: processed.contentType || mimeTypeForFormat(format),
			});
		});

		const result = await Effect.runPromise(
			Effect.either(runnable.pipe(Effect.provide(AppLayerWithContainer))),
		);

		if (Either.isRight(result)) {
			message.ack();
			continue;
		}

		const finalAttempt = message.attempts >= METADATA_MAX_ATTEMPTS;
		console.error(
			`Metadata queue failed for file ${fileId} (attempt ${message.attempts})`,
			result.left,
		);

		if (finalAttempt) {
			message.ack();
			continue;
		}

		message.retry();
	}
};
