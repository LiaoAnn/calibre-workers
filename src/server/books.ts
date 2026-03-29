import { env } from "cloudflare:workers";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { requiredSessionMiddleware } from "#/middleware/auth";
import type { MetadataQueueMessage } from "#/queue";
import {
	getBookById,
	listBookFilesForMetadataSync,
	listBooks,
	setBookFilesMetadataStatus,
	type UpdateBookInput,
	updateBook,
} from "#/services/BookService";

interface ListBooksServerInput {
	page?: number;
	limit?: number;
	author?: string;
}

interface GetBookByIdServerInput {
	bookId: string;
}

export const listBooksServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: ListBooksServerInput | undefined) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			listBooks({
				page: data?.page,
				limit: data?.limit,
				author: data?.author,
			}).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});

export const getBookByIdServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: GetBookByIdServerInput) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			getBookById(data.bookId).pipe(
				Effect.catchTag("BookNotFound", () => Effect.die(notFound())),
				Effect.provide(AppLayer),
			),
		);
	});

export const updateBookServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: UpdateBookInput) => input)
	.handler(async ({ data }) => {
		const files = await Effect.runPromise(
			Effect.gen(function* () {
				yield* updateBook(data);
				const files = yield* listBookFilesForMetadataSync(data.bookId);

				if (files.length > 0) {
					yield* setBookFilesMetadataStatus({
						bookId: data.bookId,
						fileIds: files.map((file) => file.fileId),
						status: "pending",
					});
				}

				return files;
			}).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);

		if (files.length > 0) {
			const messages = files.map((file) => ({
				body: {
					bookId: file.bookId,
					fileId: file.fileId,
					r2Key: file.r2Key,
					format: file.format,
				} satisfies MetadataQueueMessage,
			}));

			try {
				await env.METADATA_QUEUE.sendBatch(messages);
			} catch (error) {
				await Effect.runPromise(
					setBookFilesMetadataStatus({
						bookId: data.bookId,
						fileIds: files.map((file) => file.fileId),
						status: "failed",
					}).pipe(Effect.provide(AppLayer)),
				);
				throw error;
			}
		}

		return { queuedFileCount: files.length };
	});
