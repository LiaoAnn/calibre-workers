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

interface ListBooksServerInput {
	page?: number;
	limit?: number;
}

interface GetBookByIdServerInput {
	bookId: string;
}

export const listBooksServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: ListBooksServerInput | undefined) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			listBooks({
				page: data?.page,
				limit: data?.limit,
			}).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});

export const getBookByIdServerFn = createServerFn({ method: "GET" })
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
		return Effect.runPromise(
			updateBook(data).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});
