import "@tanstack/react-start/server-only";

import { Cause, Duration, Effect, Either, Exit } from "effect";
import { BookService } from "#/features/books/services/BookService";
import { FileService } from "#/features/files/services/FileService";
import type { BookFileFormat } from "#/shared/db/schema";
import { QueueRuntime } from "#/shared/layers/AppRuntime";
import { ConverterContainerContext } from "#/shared/layers/ConverterContainerLayer";
import { r2Keys } from "#/shared/lib/r2-keys";
import { queueOutcomeForExit } from "#/shared/queue/queueOutcome";

export interface MetadataQueueMessage {
	jobId: string;
}

const METADATA_TASK_TIMEOUT = Duration.minutes(10);

// One message per fibre against D1 and the converter container, both of which
// have their own limits; an unbounded batch could exceed either.
const MAX_CONCURRENT_MESSAGES = 4;

// Files within one book are converted in parallel; keep the fan-out modest.
const MAX_CONCURRENT_FILES = 4;

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

const runMetadataSyncForFile = ({
	bookId,
	fileId,
	r2Key,
	format,
	metadataForContainer,
	cover,
}: {
	bookId: string;
	fileId: string;
	r2Key: string;
	format: BookFileFormat;
	metadataForContainer: {
		title: string;
		authors: string[];
		language?: string;
		publisher?: string;
	};
	cover?: {
		bytes: ArrayBuffer;
		contentType?: string;
	};
}) =>
	Effect.gen(function* () {
		yield* BookService.setBookFileMetadataStatus({
			bookId,
			fileId,
			status: "processing",
			onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
		});

		const source = yield* FileService.getBookFile(r2Key);

		// Stream R2 body → process container → R2.
		// No ArrayBuffer buffering in the Worker for the main book file.
		const container = yield* ConverterContainerContext;
		const processed = yield* container.process(source.body, {
			formatFrom: format,
			formatTo: format,
			metadata: metadataForContainer,
			cover,
		});

		yield* FileService.uploadBookFile({
			r2Key,
			body: processed.body,
			contentType: processed.contentType || mimeTypeForFormat(format),
			expectedSize: processed.size || undefined,
		});

		yield* BookService.setBookFileMetadataStatus({
			bookId,
			fileId,
			status: "ready",
			onlyIfCurrentStatusIn: ["processing"],
		});
	}).pipe(
		Effect.catchAllCause((cause) =>
			BookService.setBookFileMetadataStatus({
				bookId,
				fileId,
				status: "failed",
				onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
			}).pipe(
				Effect.tapErrorCause(Effect.logError),
				Effect.catchAll(() => Effect.void),
				Effect.zipRight(Effect.failCause(cause)),
			),
		),
	);

const runMetadataSync = (jobId: string) =>
	Effect.gen(function* () {
		const job = yield* BookService.getMetadataJob(jobId);

		yield* BookService.updateMetadataJobStatus(jobId, {
			status: "processing",
		});

		const files = yield* BookService.listBookFilesForMetadataSync(job.bookId);

		if (files.length === 0) {
			yield* BookService.updateMetadataJobStatus(jobId, {
				status: "done",
			});
			return;
		}

		yield* BookService.setBookFilesMetadataStatus({
			bookId: job.bookId,
			fileIds: files.map((file) => file.fileId),
			status: "processing",
			onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
		});

		const latestMetadata = yield* BookService.getBookMetadataForProcess(
			job.bookId,
		);
		const { hasCover, ...metadataForContainer } = latestMetadata;

		const cover = hasCover
			? yield* Effect.gen(function* () {
					const coverObject = yield* FileService.getBookFile(
						r2Keys.bookCover({ bookId: job.bookId }),
					);
					const coverBytes = yield* Effect.tryPromise({
						try: () => coverObject.arrayBuffer(),
						catch: (cause) =>
							new Error(
								`arrayBuffer failed for metadata cover sync ${jobId}: ${String(cause)}`,
							),
					});

					return {
						bytes: coverBytes,
						contentType: coverObject.httpMetadata?.contentType,
					};
				})
			: undefined;

		const results = yield* Effect.forEach(
			files,
			(file) =>
				runMetadataSyncForFile({
					bookId: job.bookId,
					fileId: file.fileId,
					r2Key: file.r2Key,
					format: file.format,
					metadataForContainer,
					cover,
				}).pipe(Effect.either),
			{ concurrency: MAX_CONCURRENT_FILES },
		);

		const failedCount = results.filter(Either.isLeft).length;
		if (failedCount > 0) {
			return yield* Effect.fail(
				new Error(
					`Metadata sync failed for ${failedCount} file(s) in job ${jobId}`,
				),
			);
		}

		yield* BookService.updateMetadataJobStatus(jobId, {
			status: "done",
		});
	});

const settleMetadataFailure = ({
	jobId,
	message,
	errorMessage,
}: {
	jobId: string;
	message: Message<MetadataQueueMessage>;
	errorMessage: string;
}) =>
	Effect.gen(function* () {
		yield* BookService.updateMetadataJobStatus(jobId, {
			status: "failed",
			errorMessage,
		}).pipe(
			Effect.tapErrorCause(Effect.logError),
			Effect.catchAll(() => Effect.void),
		);

		const jobResult = yield* Effect.either(BookService.getMetadataJob(jobId));
		if (Either.isRight(jobResult)) {
			yield* BookService.setBookFilesMetadataStatus({
				bookId: jobResult.right.bookId,
				status: "failed",
				onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
			}).pipe(
				Effect.tapErrorCause(Effect.logError),
				Effect.catchAll(() => Effect.void),
			);
		}

		yield* Effect.sync(() => {
			message.ack();
		});
	});

export const handleMetadataQueue: ExportedHandlerQueueHandler<
	Env,
	MetadataQueueMessage
> = async (batch, _env) => {
	const processMessage = (message: Message<MetadataQueueMessage>) =>
		Effect.gen(function* () {
			const { jobId } = message.body;
			const exit = yield* Effect.exit(
				runMetadataSync(jobId).pipe(Effect.timeout(METADATA_TASK_TIMEOUT)),
			);

			if (Exit.isSuccess(exit)) {
				yield* Effect.sync(() => message.ack());
				return;
			}

			if (queueOutcomeForExit(exit) === "retry") {
				// A defect is a bug, not a job outcome. Leave the message unacked so
				// Cloudflare redelivers it and it eventually reaches the DLQ, rather
				// than discarding it and reporting the job as merely "failed".
				yield* Effect.logError(
					`metadata job ${jobId} hit a defect (attempt ${message.attempts}); leaving the message for redelivery`,
					exit.cause,
				);
				yield* Effect.sync(() => message.retry());
				return;
			}

			yield* Effect.logWarning(
				`metadata job ${jobId} failed (attempt ${message.attempts})`,
				exit.cause,
			);

			yield* settleMetadataFailure({
				jobId,
				message,
				errorMessage: Cause.pretty(exit.cause),
			});
		});

	await QueueRuntime.runPromise(
		Effect.forEach(batch.messages, processMessage, {
			concurrency: MAX_CONCURRENT_MESSAGES,
			discard: true,
		}),
	);
};
