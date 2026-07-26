import "@tanstack/react-start/server-only";

import { Cause, Duration, Effect, Either, Exit } from "effect";
import {
	getBookMetadataForProcess,
	getMetadataJob,
	listBookFilesForMetadataSync,
	setBookFileMetadataStatus,
	setBookFilesMetadataStatus,
	updateMetadataJobStatus,
} from "#/features/books/services/BookService";
import {
	getBookFile,
	uploadBookFile,
} from "#/features/files/services/FileService";
import type { BookFileFormat } from "#/shared/db/schema";
import { QueueRuntime } from "#/shared/layers/AppRuntime";
import { ConverterContainerContext } from "#/shared/layers/ConverterContainerLayer";
import { r2Keys } from "#/shared/lib/r2-keys";

export interface MetadataQueueMessage {
	jobId: string;
}

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
		yield* setBookFileMetadataStatus({
			bookId,
			fileId,
			status: "processing",
			onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
		});

		const source = yield* getBookFile(r2Key);

		// Stream R2 body → process container → R2.
		// No ArrayBuffer buffering in the Worker for the main book file.
		const container = yield* ConverterContainerContext;
		const processed = yield* container.process(source.body, {
			formatFrom: format,
			formatTo: format,
			metadata: metadataForContainer,
			cover,
		});

		yield* uploadBookFile({
			r2Key,
			body: processed.body,
			contentType: processed.contentType || mimeTypeForFormat(format),
			expectedSize: processed.size || undefined,
		});

		yield* setBookFileMetadataStatus({
			bookId,
			fileId,
			status: "ready",
			onlyIfCurrentStatusIn: ["processing"],
		});
	}).pipe(
		Effect.catchAllCause((cause) =>
			setBookFileMetadataStatus({
				bookId,
				fileId,
				status: "failed",
				onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
			}).pipe(
				Effect.catchAll(() => Effect.void),
				Effect.zipRight(Effect.failCause(cause)),
			),
		),
	);

const runMetadataSync = (jobId: string) =>
	Effect.gen(function* () {
		const job = yield* getMetadataJob(jobId);

		yield* updateMetadataJobStatus(jobId, {
			status: "processing",
		});

		const files = yield* listBookFilesForMetadataSync(job.bookId);

		if (files.length === 0) {
			yield* updateMetadataJobStatus(jobId, {
				status: "done",
			});
			return;
		}

		yield* setBookFilesMetadataStatus({
			bookId: job.bookId,
			fileIds: files.map((file) => file.fileId),
			status: "processing",
			onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
		});

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
			{ concurrency: "unbounded" },
		);

		const failedCount = results.filter(Either.isLeft).length;
		if (failedCount > 0) {
			return yield* Effect.fail(
				new Error(
					`Metadata sync failed for ${failedCount} file(s) in job ${jobId}`,
				),
			);
		}

		yield* updateMetadataJobStatus(jobId, {
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
		yield* Effect.sync(() => {
			console.error(
				`Metadata queue failed for job ${jobId} (attempt ${message.attempts})`,
				errorMessage,
			);
		});

		yield* updateMetadataJobStatus(jobId, {
			status: "failed",
			errorMessage,
		}).pipe(Effect.catchAll(() => Effect.void));

		const jobResult = yield* Effect.either(getMetadataJob(jobId));
		if (Either.isRight(jobResult)) {
			yield* setBookFilesMetadataStatus({
				bookId: jobResult.right.bookId,
				status: "failed",
				onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
			}).pipe(Effect.catchAll(() => Effect.void));
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

			yield* settleMetadataFailure({
				jobId,
				message,
				errorMessage: Cause.pretty(exit.cause),
			});
		}).pipe(
			Effect.catchAllCause((cause) =>
				Effect.gen(function* () {
					const { jobId } = message.body;
					const causePretty = Cause.pretty(cause);
					console.error(
						`Unexpected metadata queue failure for job ${jobId} (attempt ${message.attempts})`,
						causePretty,
					);

					yield* updateMetadataJobStatus(jobId, {
						status: "failed",
						errorMessage: causePretty,
					}).pipe(Effect.catchAll(() => Effect.void));

					const jobResult = yield* Effect.either(getMetadataJob(jobId));
					if (Either.isRight(jobResult)) {
						yield* setBookFilesMetadataStatus({
							bookId: jobResult.right.bookId,
							status: "failed",
							onlyIfCurrentStatusIn: ["pending", "processing", "failed"],
						}).pipe(Effect.catchAll(() => Effect.void));
					}

					yield* Effect.sync(() => {
						message.ack();
					});
				}),
			),
		);

	await QueueRuntime.runPromise(
		Effect.forEach(batch.messages, processMessage, {
			concurrency: "unbounded",
			discard: true,
		}),
	);
};
