import type { SqlError } from "@effect/sql/SqlError";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import type { DatabaseContext } from "#/layers/DatabaseLayer";
import { requiredSessionMiddleware } from "#/middleware/auth";
import type {
	InvalidShelfName,
	ShelfAccessDenied,
	ShelfNotFound,
} from "#/services/ShelfService";
import {
	addBooksToShelf,
	createShelf,
	deleteShelf,
	listBookShelfIds,
	listShelfBooks,
	listShelves,
	removeBookFromShelf,
	updateShelf,
} from "#/services/ShelfService";

interface ShelfByIdInput {
	shelfId: string;
}

interface BookShelfIdsInput {
	bookId: string;
}

interface ShelfBooksInput extends ShelfByIdInput {
	page?: number;
	limit?: number;
}

interface CreateShelfInput {
	name: string;
}

interface UpdateShelfInput extends ShelfByIdInput {
	name?: string;
}

interface AddBooksInput extends ShelfByIdInput {
	bookIds: string[];
}

interface RemoveBookInput extends ShelfByIdInput {
	bookId: string;
}

const runShelfEffect = <T>(
	effect: Effect.Effect<
		T,
		ShelfNotFound | ShelfAccessDenied | InvalidShelfName | SqlError,
		DatabaseContext
	>,
): Promise<T> =>
	Effect.runPromise(
		effect.pipe(
			Effect.catchTag("ShelfNotFound", () =>
				Effect.die(new Error("書架不存在")),
			),
			Effect.catchTag("ShelfAccessDenied", () =>
				Effect.die(new Error("沒有權限存取此書架")),
			),
			Effect.catchTag("InvalidShelfName", (error: InvalidShelfName) =>
				Effect.die(new Error(error.reason)),
			),
			Effect.catchTag("SqlError", (error) =>
				Effect.die(new Error(`[SqlError] ${String(error.message)}`)),
			),
			Effect.provide(AppLayer),
		),
	);

export const listShelvesServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return runShelfEffect(listShelves(context.session.user.id));
	});

export const listBookShelfIdsServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: BookShelfIdsInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			listBookShelfIds({
				userId: context.session.user.id,
				bookId: data.bookId,
			}),
		);
	});

export const createShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: CreateShelfInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			createShelf({
				userId: context.session.user.id,
				name: data.name,
			}),
		);
	});

export const getShelfBooksServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: ShelfBooksInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			listShelfBooks({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				page: data.page,
				limit: data.limit,
			}),
		);
	});

export const updateShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: UpdateShelfInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			updateShelf({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				name: data.name,
			}),
		);
	});

export const deleteShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: ShelfByIdInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			deleteShelf({
				userId: context.session.user.id,
				shelfId: data.shelfId,
			}),
		);
	});

export const addBooksToShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: AddBooksInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			addBooksToShelf({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				bookIds: data.bookIds,
			}),
		);
	});

export const removeBookFromShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: RemoveBookInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			removeBookFromShelf({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				bookId: data.bookId,
			}),
		);
	});
