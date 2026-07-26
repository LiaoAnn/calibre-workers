import "@tanstack/react-start/server-only";

import { and, eq, inArray, lt } from "drizzle-orm";
import { Data, Effect } from "effect";
import * as schema from "#/shared/db/schema";
import { DatabaseContext, DatabaseLive } from "#/shared/layers/DatabaseLayer";
import { R2Context, R2Live } from "#/shared/layers/R2Layer";

class FileNotFound extends Data.TaggedError("FileNotFound")<{
	readonly fileId: string;
}> {}

class StorageError extends Data.TaggedError("StorageError")<{
	readonly operation: string;
	readonly cause: unknown;
}> {}

interface UploadBookFileInput {
	r2Key: string;
	body: ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>;
	contentType?: string;
	expectedSize?: number;
}

interface CreateMultipartUploadInput {
	r2Key: string;
	contentType?: string;
	customMetadata?: Record<string, string>;
}

type MultipartUploadValue =
	| ArrayBuffer
	| ArrayBufferView
	| ReadableStream<Uint8Array>
	| string
	| Blob;

interface UploadMultipartPartInput {
	r2Key: string;
	uploadId: string;
	partNumber: number;
	body: MultipartUploadValue;
}

interface CompleteMultipartUploadInput {
	r2Key: string;
	uploadId: string;
	uploadedParts: R2UploadedPart[];
}

interface GetBookFileRangeInput {
	r2Key: string;
	range: R2Range;
}

interface FailStaleUploadTasksInput {
	staleBefore: Date;
	errorMessage: string;
}

export class FileService extends Effect.Service<FileService>()("FileService", {
	accessors: true,
	dependencies: [DatabaseLive, R2Live],
	effect: Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const storage = yield* R2Context;

		const uploadBookFile = Effect.fn("FileService.uploadBookFile")(function* ({
			r2Key,
			body,
			contentType,
			expectedSize,
		}: UploadBookFileInput) {
			const uploaded = yield* Effect.tryPromise({
				try: () => storage.put(r2Key, body, { httpMetadata: { contentType } }),
				catch: (cause) => new StorageError({ operation: "file.upload", cause }),
			});

			if (typeof expectedSize === "number" && uploaded.size !== expectedSize) {
				yield* Effect.tryPromise({
					try: () => storage.delete(r2Key),
					catch: (cause) =>
						new StorageError({
							operation: "file.deleteAfterSizeMismatch",
							cause,
						}),
				}).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

				return yield* Effect.fail(
					new StorageError({
						operation: "file.upload.sizeMismatch",
						cause: {
							r2Key,
							expectedSize,
							uploadedSize: uploaded.size,
						},
					}),
				);
			}

			return { size: uploaded.size };
		});

		const deleteBookFile = Effect.fn("FileService.deleteBookFile")(function* (
			r2Key: string,
		) {
			yield* Effect.tryPromise({
				try: () => storage.delete(r2Key),
				catch: (cause) => new StorageError({ operation: "file.delete", cause }),
			});
		});

		const getBookFileRecord = Effect.fn("FileService.getBookFileRecord")(
			function* (bookId: string, fileId: string) {
				const rows = yield* database
					.select()
					.from(schema.bookFiles)
					.where(
						and(
							eq(schema.bookFiles.bookId, bookId),
							eq(schema.bookFiles.id, fileId),
						),
					)
					.limit(1);

				const fileRecord = rows[0];
				if (!fileRecord) {
					return yield* Effect.fail(new FileNotFound({ fileId }));
				}

				return fileRecord;
			},
		);

		const getBookFile = Effect.fn("FileService.getBookFile")(function* (
			r2Key: string,
		) {
			const object = yield* Effect.tryPromise({
				try: () => storage.get(r2Key),
				catch: (cause) => new StorageError({ operation: "file.get", cause }),
			});

			if (!object) {
				return yield* Effect.fail(
					new StorageError({ operation: "file.notFound", cause: r2Key }),
				);
			}

			return object;
		});

		const getBookFileRange = Effect.fn("FileService.getBookFileRange")(
			function* ({ r2Key, range }: GetBookFileRangeInput) {
				const object = yield* Effect.tryPromise({
					try: () => storage.get(r2Key, { range }),
					catch: (cause) =>
						new StorageError({ operation: "file.getRange", cause }),
				});

				if (!object) {
					return yield* Effect.fail(
						new StorageError({ operation: "file.rangeNotFound", cause: r2Key }),
					);
				}

				return yield* Effect.tryPromise({
					try: () => object.bytes(),
					catch: (cause) =>
						new StorageError({ operation: "file.getRange.bytes", cause }),
				});
			},
		);

		const createMultipartUpload = Effect.fn(
			"FileService.createMultipartUpload",
		)(function* ({
			r2Key,
			contentType,
			customMetadata,
		}: CreateMultipartUploadInput) {
			return yield* Effect.tryPromise({
				try: () =>
					storage.createMultipartUpload(r2Key, {
						httpMetadata: contentType ? { contentType } : undefined,
						customMetadata,
					}),
				catch: (cause) =>
					new StorageError({ operation: "file.multipart.create", cause }),
			});
		});

		const uploadMultipartPart = Effect.fn("FileService.uploadMultipartPart")(
			function* ({
				r2Key,
				uploadId,
				partNumber,
				body,
			}: UploadMultipartPartInput) {
				const multipart = storage.resumeMultipartUpload(r2Key, uploadId);

				return yield* Effect.tryPromise({
					try: () => multipart.uploadPart(partNumber, body),
					catch: (cause) =>
						new StorageError({ operation: "file.multipart.uploadPart", cause }),
				});
			},
		);

		const completeMultipartUpload = Effect.fn(
			"FileService.completeMultipartUpload",
		)(function* ({
			r2Key,
			uploadId,
			uploadedParts,
		}: CompleteMultipartUploadInput) {
			const multipart = storage.resumeMultipartUpload(r2Key, uploadId);

			return yield* Effect.tryPromise({
				try: () => multipart.complete(uploadedParts),
				catch: (cause) =>
					new StorageError({ operation: "file.multipart.complete", cause }),
			});
		});

		const abortMultipartUpload = Effect.fn("FileService.abortMultipartUpload")(
			function* ({ r2Key, uploadId }: { r2Key: string; uploadId: string }) {
				const multipart = storage.resumeMultipartUpload(r2Key, uploadId);

				yield* Effect.tryPromise({
					try: () => multipart.abort(),
					catch: (cause) =>
						new StorageError({ operation: "file.multipart.abort", cause }),
				});
			},
		);

		const failStaleUploadTasks = Effect.fn("FileService.failStaleUploadTasks")(
			function* ({ staleBefore, errorMessage }: FailStaleUploadTasksInput) {
				const staleTasks = yield* database
					.select({
						id: schema.uploadTasks.id,
						stagingR2Key: schema.uploadTasks.stagingR2Key,
						multipartUploadId: schema.uploadTasks.multipartUploadId,
					})
					.from(schema.uploadTasks)
					.where(
						and(
							inArray(schema.uploadTasks.status, ["pending", "processing"]),
							lt(schema.uploadTasks.updatedAt, staleBefore),
						),
					);

				if (staleTasks.length === 0) {
					return { affectedCount: 0 };
				}

				yield* Effect.forEach(
					staleTasks,
					(task) =>
						Effect.gen(function* () {
							if (task.stagingR2Key && task.multipartUploadId) {
								yield* abortMultipartUpload({
									r2Key: task.stagingR2Key,
									uploadId: task.multipartUploadId,
								}).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
							}

							if (task.stagingR2Key) {
								yield* deleteBookFile(task.stagingR2Key).pipe(
									Effect.catchAll(() => Effect.succeed(undefined)),
								);
							}
						}),
					{ concurrency: "unbounded", discard: true },
				);

				const staleIds = staleTasks.map((task) => task.id);
				yield* database
					.update(schema.uploadTasks)
					.set({
						status: "failed",
						errorMessage,
						multipartUploadId: null,
						stagingR2Key: null,
						updatedAt: new Date(),
					})
					.where(inArray(schema.uploadTasks.id, staleIds));

				return { affectedCount: staleIds.length };
			},
		);

		return {
			uploadBookFile,
			deleteBookFile,
			getBookFileRecord,
			getBookFile,
			getBookFileRange,
			createMultipartUpload,
			uploadMultipartPart,
			completeMultipartUpload,
			abortMultipartUpload,
			failStaleUploadTasks,
		};
	}),
}) {}
