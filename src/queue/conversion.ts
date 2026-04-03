import "@tanstack/react-start/server-only";

import { Effect, Either } from "effect";
import type { BookFileFormat } from "#/db/schema";
import { AppLayerWithContainer } from "#/layers/AppLayer";
import { ConverterContainerContext } from "#/layers/ConverterContainerLayer";
import { r2Keys } from "#/lib/r2-keys";
import { getBookMetadataForProcess } from "#/services/BookService";
import {
	createBookFile,
	getConversionJob,
	updateConversionJobStatus,
} from "#/services/ConversionService";
import {
	getBookFile,
	getBookFileRecord,
	uploadBookFile,
} from "#/services/FileService";

export interface ConversionQueueMessage {
	jobId: string;
}

const CONVERSION_MAX_ATTEMPTS = 3;

const isBookFileFormat = (format: string): format is BookFileFormat =>
	format === "epub" ||
	format === "kepub" ||
	format === "azw3" ||
	format === "mobi";

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

export const handleConversionQueue: ExportedHandlerQueueHandler<
	Env,
	ConversionQueueMessage
> = async (batch, _env) => {
	for (const message of batch.messages) {
		const { jobId } = message.body;

		const runnable = Effect.gen(function* () {
			const job = yield* getConversionJob(jobId);

			if (!isBookFileFormat(job.targetFormat)) {
				return yield* Effect.fail(
					new Error(`Unsupported target format: ${job.targetFormat}`),
				);
			}

			yield* updateConversionJobStatus(jobId, { status: "processing" });

			const fileRecord = yield* getBookFileRecord(job.bookId, job.sourceFileId);

			const r2Object = yield* getBookFile(fileRecord.r2Key);
			const bytes = yield* Effect.tryPromise({
				try: () => r2Object.arrayBuffer(),
				catch: (cause) => new Error(`arrayBuffer failed: ${String(cause)}`),
			});

			const container = yield* ConverterContainerContext;
			const latestMetadata = yield* getBookMetadataForProcess(job.bookId);
			const { hasCover, ...metadataForContainer } = latestMetadata;
			const cover = hasCover
				? yield* Effect.gen(function* () {
						const coverObject = yield* getBookFile(
							r2Keys.bookCover({ bookId: job.bookId }),
						);
						const coverBytes = yield* Effect.tryPromise({
							try: () => coverObject.arrayBuffer(),
							catch: (cause) =>
								new Error(
									`cover arrayBuffer failed for job ${jobId}: ${String(cause)}`,
								),
						});

						return {
							bytes: coverBytes,
							contentType: coverObject.httpMetadata?.contentType,
						};
					})
				: undefined;

			const convertedBytes = yield* container.convert(
				bytes,
				fileRecord.format,
				job.targetFormat,
			);

			const processed = yield* container.process(convertedBytes, {
				formatFrom: job.targetFormat,
				formatTo: job.targetFormat,
				metadata: metadataForContainer,
				cover,
			});

			const baseName = fileRecord.fileName.replace(/\.[^.]+$/, "");
			const resultFileName = `${baseName}.${job.targetFormat}`;
			const resultR2Key = r2Keys.bookFile({
				bookId: job.bookId,
				fileName: resultFileName,
			});

			yield* uploadBookFile({
				r2Key: resultR2Key,
				body: processed.bytes,
				contentType:
					processed.contentType || mimeTypeForFormat(job.targetFormat),
				expectedSize: processed.bytes.byteLength,
			});

			const { fileId: resultFileId } = yield* createBookFile({
				bookId: job.bookId,
				format: job.targetFormat,
				fileName: resultFileName,
				r2Key: resultR2Key,
				size: processed.bytes.byteLength,
				mimeType: processed.contentType || mimeTypeForFormat(job.targetFormat),
			});

			yield* updateConversionJobStatus(jobId, {
				status: "done",
				resultFileId,
			});
		});

		const result = await Effect.runPromise(
			Effect.either(runnable.pipe(Effect.provide(AppLayerWithContainer))),
		);

		if (Either.isRight(result)) {
			message.ack();
			continue;
		}

		const finalAttempt = message.attempts >= CONVERSION_MAX_ATTEMPTS;
		const failedStatus = finalAttempt ? "failed" : "pending";

		await Effect.runPromise(
			updateConversionJobStatus(jobId, {
				status: failedStatus,
				errorMessage: String(result.left),
			}).pipe(
				Effect.catchAll(() => Effect.void),
				Effect.provide(AppLayerWithContainer),
			),
		);

		if (finalAttempt) {
			message.ack();
			continue;
		}

		message.retry();
	}
};
