import { env } from "cloudflare:workers";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { requiredSessionMiddleware } from "#/middleware/auth";
import {
	getBookById,
	listBooks,
	type UpdateBookInput,
	updateBook,
} from "#/services/BookService";
import type { SyncBookMetadataParams } from "#/workflows/types";

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
	.handler(async ({ data, context }) => {
		const result = await Effect.runPromise(
			updateBook(data).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);

		const workflowBinding = env.SYNC_BOOK_METADATA_WORKFLOW;

		const workflowParams: SyncBookMetadataParams = {
			bookId: data.bookId,
			triggeredByUserId: context.session.user.id,
			reason: "book-metadata-updated",
		};

		const normalizedBookId = data.bookId
			.toLowerCase()
			.replace(/[^a-z0-9_-]/g, "-")
			.slice(0, 48);
		const workflowInstanceId = `book-metadata-${normalizedBookId}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

		await workflowBinding.create({
			id: workflowInstanceId,
			params: workflowParams,
		});

		return result;
	});
