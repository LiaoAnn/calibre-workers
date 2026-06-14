import "@tanstack/react-start/server-only";

import { and, eq, inArray, lt } from "drizzle-orm";
import { Data, Effect } from "effect";
import * as schema from "#/shared/db/schema";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";
import { R2Context } from "#/shared/layers/R2Layer";

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

export const uploadBookFile = ({
	r2Key,
	body,
	contentType,
	expectedSize,
}: UploadBookFileInput) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;

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

export const deleteBookFile = (r2Key: string) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;

		yield* Effect.tryPromise({
			try: () => storage.delete(r2Key),
			catch: (cause) => new StorageError({ operation: "file.delete", cause }),
		});
	});

export const getBookFileRecord = (bookId: string, fileId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

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
	});

export const getBookFile = (r2Key: string) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;

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

export const getBookFileRange = ({ r2Key, range }: GetBookFileRangeInput) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;

		const object = yield* Effect.tryPromise({
			try: () => storage.get(r2Key, { range }),
			catch: (cause) => new StorageError({ operation: "file.getRange", cause }),
		});

		if (!object) {
			return yield* Effect.fail(
				new StorageError({ operation: "file.rangeNotFound", cause: r2Key }),
			);
		}

		const bytes = yield* Effect.tryPromise({
			try: () => object.bytes(),
			catch: (cause) =>
				new StorageError({ operation: "file.getRange.bytes", cause }),
		});

		return bytes;
	});

export const createMultipartUpload = ({
	r2Key,
	contentType,
	customMetadata,
}: CreateMultipartUploadInput) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;

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

export const uploadMultipartPart = ({
	r2Key,
	uploadId,
	partNumber,
	body,
}: UploadMultipartPartInput) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;
		const multipart = storage.resumeMultipartUpload(r2Key, uploadId);

		return yield* Effect.tryPromise({
			try: () => multipart.uploadPart(partNumber, body),
			catch: (cause) =>
				new StorageError({ operation: "file.multipart.uploadPart", cause }),
		});
	});

export const completeMultipartUpload = ({
	r2Key,
	uploadId,
	uploadedParts,
}: CompleteMultipartUploadInput) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;
		const multipart = storage.resumeMultipartUpload(r2Key, uploadId);

		return yield* Effect.tryPromise({
			try: () => multipart.complete(uploadedParts),
			catch: (cause) =>
				new StorageError({ operation: "file.multipart.complete", cause }),
		});
	});

export const abortMultipartUpload = ({
	r2Key,
	uploadId,
}: {
	r2Key: string;
	uploadId: string;
}) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;
		const multipart = storage.resumeMultipartUpload(r2Key, uploadId);

		yield* Effect.tryPromise({
			try: () => multipart.abort(),
			catch: (cause) =>
				new StorageError({ operation: "file.multipart.abort", cause }),
		});
	});

export const failStaleUploadTasks = ({
	staleBefore,
	errorMessage,
}: {
	staleBefore: Date;
	errorMessage: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

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
	});
