import "@tanstack/react-start/server-only";

import { Cause, Data, Duration, Effect, Exit } from "effect";
import { BookService } from "#/features/books/services/BookService";
import { ConversionService } from "#/features/conversion/services/ConversionService";
import { FileService } from "#/features/files/services/FileService";
import type { BookFileFormat } from "#/shared/db/schema";
import { QueueRuntime } from "#/shared/layers/AppRuntime";
import { ConverterContainerContext } from "#/shared/layers/ConverterContainerLayer";
import { r2Keys } from "#/shared/lib/r2-keys";
import { queueOutcomeForExit } from "#/shared/queue/queueOutcome";

export interface ConversionQueueMessage {
	jobId: string;
}

const CONVERSION_TASK_TIMEOUT = Duration.minutes(10);

// One message per fibre against D1 and the converter container, both of which
// have their own limits; an unbounded batch could exceed either.
const MAX_CONCURRENT_MESSAGES = 4;

class UnsupportedTargetFormat extends Data.TaggedError(
	"UnsupportedTargetFormat",
)<{
	readonly jobId: string;
	readonly targetFormat: string;
}> {}

class CoverReadFailed extends Data.TaggedError("CoverReadFailed")<{
	readonly jobId: string;
	readonly cause: unknown;
}> {}

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

const runConversionJob = (jobId: string) =>
	Effect.gen(function* () {
		const job = yield* ConversionService.getConversionJob(jobId);

		if (!isBookFileFormat(job.targetFormat)) {
			return yield* Effect.fail(
				new UnsupportedTargetFormat({
					jobId,
					targetFormat: job.targetFormat,
				}),
			);
		}

		yield* ConversionService.updateConversionJobStatus(jobId, {
			status: "processing",
		});

		const fileRecord = yield* FileService.getBookFileRecord(
			job.bookId,
			job.sourceFileId,
		);

		const r2Object = yield* FileService.getBookFile(fileRecord.r2Key);

		const container = yield* ConverterContainerContext;
		const latestMetadata = yield* BookService.getBookMetadataForProcess(
			job.bookId,
		);
		const { hasCover, ...metadataForContainer } = latestMetadata;
		const cover = hasCover
			? yield* Effect.gen(function* () {
					const coverObject = yield* FileService.getBookFile(
						r2Keys.bookCover({ bookId: job.bookId }),
					);
					// Covers are small (< 5 MB) — safe to buffer in Worker memory
					const coverBytes = yield* Effect.tryPromise({
						try: () => coverObject.arrayBuffer(),
						catch: (cause) => new CoverReadFailed({ jobId, cause }),
					});

					return {
						bytes: coverBytes,
						contentType: coverObject.httpMetadata?.contentType,
					};
				})
			: undefined;

		// Stream R2 body → convert container → process container → R2.
		// No ArrayBuffer buffering in the Worker for the main book file.
		const converted = yield* container.convert(
			r2Object.body,
			fileRecord.format,
			job.targetFormat,
		);

		const processed = yield* container.process(converted.body, {
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

		yield* FileService.uploadBookFile({
			r2Key: resultR2Key,
			body: processed.body,
			contentType: processed.contentType || mimeTypeForFormat(job.targetFormat),
			expectedSize: processed.size || undefined,
		});

		// Use r2Object.size (source file from R2) when Content-Length is missing
		// from the container response. The final accurate size comes from R2 after
		// the streamed upload; however ConversionService.createBookFile only needs a best-effort hint
		// because the file is already persisted.  When the container sets
		// Content-Length correctly (the Go handler always does) processed.size is
		// accurate.
		const { fileId: resultFileId } = yield* ConversionService.createBookFile({
			bookId: job.bookId,
			format: job.targetFormat,
			fileName: resultFileName,
			r2Key: resultR2Key,
			size: processed.size || r2Object.size,
			mimeType: processed.contentType || mimeTypeForFormat(job.targetFormat),
		});

		yield* ConversionService.updateConversionJobStatus(jobId, {
			status: "done",
			resultFileId,
		});
	});

const settleConversionFailure = ({
	jobId,
	errorMessage,
	message,
}: {
	jobId: string;
	errorMessage: string;
	message: Message<ConversionQueueMessage>;
}) =>
	Effect.gen(function* () {
		yield* ConversionService.updateConversionJobStatus(jobId, {
			status: "failed",
			errorMessage,
		}).pipe(
			Effect.tapErrorCause(Effect.logError),
			Effect.catchAll(() => Effect.void),
		);

		yield* Effect.sync(() => {
			message.ack();
		});
	});

export const handleConversionQueue: ExportedHandlerQueueHandler<
	Env,
	ConversionQueueMessage
> = async (batch, _env) => {
	const processMessage = (message: Message<ConversionQueueMessage>) =>
		Effect.gen(function* () {
			const { jobId } = message.body;
			const exit = yield* Effect.exit(
				runConversionJob(jobId).pipe(Effect.timeout(CONVERSION_TASK_TIMEOUT)),
			);

			if (Exit.isSuccess(exit)) {
				yield* Effect.sync(() => message.ack());
				return;
			}

			const causePretty = Cause.pretty(exit.cause);

			if (queueOutcomeForExit(exit) === "retry") {
				// A defect is a bug, not a job outcome. Leave the message unacked so
				// Cloudflare redelivers it and it eventually reaches the DLQ, rather
				// than discarding it and reporting the job as merely "failed".
				yield* Effect.logError(
					`conversion job ${jobId} hit a defect (attempt ${message.attempts}); leaving the message for redelivery`,
					exit.cause,
				);
				yield* Effect.sync(() => message.retry());
				return;
			}

			yield* Effect.logWarning(
				`conversion job ${jobId} failed (attempt ${message.attempts})`,
				exit.cause,
			);

			yield* settleConversionFailure({
				jobId,
				errorMessage: causePretty,
				message,
			});
		});

	await QueueRuntime.runPromise(
		Effect.forEach(batch.messages, processMessage, {
			concurrency: MAX_CONCURRENT_MESSAGES,
			discard: true,
		}),
	);
};
