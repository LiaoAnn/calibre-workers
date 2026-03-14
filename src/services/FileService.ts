import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import * as schema from "#/db/schema";
import { DatabaseContext } from "#/layers/DatabaseLayer";
import { R2Context } from "#/layers/R2Layer";

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
}

export const uploadBookFile = ({
	r2Key,
	body,
	contentType,
}: UploadBookFileInput) =>
	Effect.gen(function* () {
		const storage = yield* R2Context;

		yield* Effect.tryPromise({
			try: () => storage.put(r2Key, body, { httpMetadata: { contentType } }),
			catch: (cause) => new StorageError({ operation: "file.upload", cause }),
		});
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
