import "@tanstack/react-start/server-only";

import { Cause, Duration, Effect, Either, Exit } from "effect";
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
const METADATA_TASK_TIMEOUT = Duration.minutes(10);

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

const runMetadataSync = ({
	bookId,
	fileId,
	r2Key,
	format,
}: MetadataQueueMessage) =>
	Effect.gen(function* () {
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
					const coverObject = yield* getBookFile(r2Keys.bookCover({ bookId }));
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

const settleMetadataFailure = ({
	bookId,
	fileId,
	attempts,
	message,
	errorMessage,
}: {
	bookId: string;
	fileId: string;
	attempts: number;
	message: Message<MetadataQueueMessage>;
	errorMessage: string;
}) =>
	Effect.gen(function* () {
		const finalAttempt = attempts >= METADATA_MAX_ATTEMPTS;
		const fallbackStatus: MetadataSyncStatus = finalAttempt
			? "failed"
			: "pending";

		yield* Effect.sync(() => {
			console.error(
				`Metadata queue failed for file ${fileId} (attempt ${attempts})`,
				errorMessage,
			);
		});

		const statusResult = yield* Effect.either(
			setBookFileMetadataStatus({
				bookId,
				fileId,
				status: fallbackStatus,
				onlyIfCurrentStatusIn: ["pending", "processing"],
			}),
		);

		yield* Effect.sync(() => {
			if (Either.isLeft(statusResult)) {
				console.error(
					`Failed to set metadata status ${fallbackStatus} for ${fileId}`,
					statusResult.left,
				);
			}

			if (finalAttempt) {
				message.ack();
				return;
			}

			message.retry();
		});
	});

export const handleMetadataQueue: ExportedHandlerQueueHandler<
	Env,
	MetadataQueueMessage
> = async (batch, _env) => {
	const processMessage = (message: Message<MetadataQueueMessage>) =>
		Effect.gen(function* () {
			const payload = message.body;
			const exit = yield* Effect.exit(
				runMetadataSync(payload).pipe(Effect.timeout(METADATA_TASK_TIMEOUT)),
			);

			if (Exit.isSuccess(exit)) {
				yield* Effect.sync(() => message.ack());
				return;
			}

			yield* settleMetadataFailure({
				bookId: payload.bookId,
				fileId: payload.fileId,
				attempts: message.attempts,
				message,
				errorMessage: Cause.pretty(exit.cause),
			});
		}).pipe(
			Effect.catchAllCause((cause) =>
				Effect.sync(() => {
					const payload = message.body;
					console.error(
						`Unexpected metadata queue failure for file ${payload.fileId} (attempt ${message.attempts})`,
						Cause.pretty(cause),
					);

					if (message.attempts >= METADATA_MAX_ATTEMPTS) {
						message.ack();
						return;
					}

					message.retry();
				}),
			),
		);

	await Effect.runPromise(
		Effect.forEach(batch.messages, processMessage, {
			concurrency: "unbounded",
			discard: true,
		}).pipe(Effect.provide(AppLayerWithContainer)),
	);
};
