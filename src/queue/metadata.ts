import "@tanstack/react-start/server-only";

import { Effect, Either } from "effect";
import type { BookFileFormat, MetadataSyncStatus } from "#/db/schema";
import { AppLayerWithContainer } from "#/layers/AppLayer";
import { ConverterContainerContext } from "#/layers/ConverterContainerLayer";
import { r2Keys } from "#/lib/r2-keys";
import {
	getBookMetadataForProcess,
	setBookFileMetadataStatus,
} from "#/services/BookService";
import { getBookFile, uploadBookFile } from "#/services/FileService";

export interface MetadataQueueMessage {
	bookId: string;
	fileId: string;
	r2Key: string;
	format: BookFileFormat;
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
			yield* setBookFileMetadataStatus({
				bookId,
				fileId,
				status: "processing",
			});

			const latestMetadata = yield* getBookMetadataForProcess(bookId);
			const source = yield* getBookFile(r2Key);
			const { hasCover, ...metadataForContainer } = latestMetadata;

			const bytes = yield* Effect.tryPromise({
				try: () => source.arrayBuffer(),
				catch: (cause) =>
					new Error(
						`arrayBuffer failed for metadata sync ${fileId}: ${String(cause)}`,
					),
			});

			const cover = hasCover
				? yield* Effect.gen(function* () {
						const coverObject = yield* getBookFile(
							r2Keys.bookCover({ bookId }),
						);
						const coverBytes = yield* Effect.tryPromise({
							try: () => coverObject.arrayBuffer(),
							catch: (cause) =>
								new Error(
									`arrayBuffer failed for cover sync ${fileId}: ${String(cause)}`,
								),
						});

						return {
							bytes: coverBytes,
							contentType: coverObject.httpMetadata?.contentType,
						};
					})
				: undefined;

			const container = yield* ConverterContainerContext;
			const processed = yield* container.process(bytes, {
				formatFrom: format,
				formatTo: format,
				metadata: metadataForContainer,
				cover,
			});

			yield* uploadBookFile({
				r2Key,
				body: processed.bytes,
				contentType: processed.contentType || mimeTypeForFormat(format),
				expectedSize: processed.bytes.byteLength,
			});

			yield* setBookFileMetadataStatus({
				bookId,
				fileId,
				status: "ready",
				onlyIfCurrentStatusIn: ["processing"],
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
		const fallbackStatus: MetadataSyncStatus = finalAttempt
			? "failed"
			: "pending";
		console.error(
			`Metadata queue failed for file ${fileId} (attempt ${message.attempts})`,
			result.left,
		);

		const statusResult = await Effect.runPromise(
			Effect.either(
				setBookFileMetadataStatus({
					bookId,
					fileId,
					status: fallbackStatus,
					onlyIfCurrentStatusIn: ["processing"],
				}).pipe(Effect.provide(AppLayerWithContainer)),
			),
		);

		if (Either.isLeft(statusResult)) {
			console.error(
				`Failed to set metadata status ${fallbackStatus} for ${fileId}`,
				statusResult.left,
			);
		}

		if (finalAttempt) {
			message.ack();
			continue;
		}

		message.retry();
	}
};
