import type { SqlError } from "@effect/sql/SqlError";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import type {
	InvalidShelfName,
	ShelfAccessDenied,
	ShelfNotFound,
} from "#/features/shelves/services/ShelfService";
import { ShelfService } from "#/features/shelves/services/ShelfService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import type { AppServices } from "#/shared/layers/AppLayer";
import { runServerEffect } from "#/shared/server/runServerEffect";
import { validateInput } from "#/shared/server/validateInput";

const ShelfId = Schema.NonEmptyString;
const BookId = Schema.NonEmptyString;

const ShelfByIdInput = Schema.Struct({ shelfId: ShelfId });

const BookShelfIdsInput = Schema.Struct({ bookId: BookId });

const ShelfBooksInput = Schema.Struct({
	shelfId: ShelfId,
	page: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
	limit: Schema.optional(
		Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
	),
});

const CreateShelfInput = Schema.Struct({ name: Schema.String });

const UpdateShelfInput = Schema.Struct({
	shelfId: ShelfId,
	name: Schema.optional(Schema.String),
});

// Bounded so one request cannot ask for an unbounded batch insert.
const AddBooksInput = Schema.Struct({
	shelfId: ShelfId,
	bookIds: Schema.Array(BookId).pipe(Schema.maxItems(500)),
});

const RemoveBookInput = Schema.Struct({ shelfId: ShelfId, bookId: BookId });

const SetShelfKoboSyncInput = Schema.Struct({
	shelfId: ShelfId,
	enabled: Schema.Boolean,
});

const runShelfEffect = <T>(
	effect: Effect.Effect<
		T,
		ShelfNotFound | ShelfAccessDenied | InvalidShelfName | SqlError,
		AppServices
	>,
): Promise<T> => runServerEffect(effect);

export const listShelvesServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return runShelfEffect(ShelfService.listShelves(context.session.user.id));
	});

export const listBookShelfIdsServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.validator(validateInput(BookShelfIdsInput))
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.listBookShelfIds({
				userId: context.session.user.id,
				bookId: data.bookId,
			}),
		);
	});

export const createShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.validator(validateInput(CreateShelfInput))
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.createShelf({
				userId: context.session.user.id,
				name: data.name,
			}),
		);
	});

export const getShelfBooksServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.validator(validateInput(ShelfBooksInput))
	.handler(async ({ data, context }) => {
		// This one backs a route loader. A loader that throws an ordinary error
		// renders the error boundary and answers 500, so an absent or inaccessible
		// shelf is turned into router `notFound()` instead — the same convention
		// `getBookByIdServerFn` already uses.
		const result = await runServerEffect(
			ShelfService.listShelfBooks({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				page: data.page,
				limit: data.limit,
			}).pipe(
				Effect.catchTags({
					ShelfNotFound: () => Effect.succeed(null),
					ShelfAccessDenied: () => Effect.succeed(null),
				}),
			),
		);

		if (!result) {
			throw notFound();
		}

		return result;
	});

export const updateShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.validator(validateInput(UpdateShelfInput))
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.updateShelf({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				name: data.name,
			}),
		);
	});

export const deleteShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.validator(validateInput(ShelfByIdInput))
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.deleteShelf({
				userId: context.session.user.id,
				shelfId: data.shelfId,
			}),
		);
	});

export const addBooksToShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.validator(validateInput(AddBooksInput))
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.addBooksToShelf({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				bookIds: data.bookIds,
			}),
		);
	});

export const removeBookFromShelfServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.validator(validateInput(RemoveBookInput))
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.removeBookFromShelf({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				bookId: data.bookId,
			}),
		);
	});

// Per-shelf Kobo sync settings live here because they own the shelfMembers
// table. The Kobo settings page composes these with the kobo token endpoints.
export const listShelfKoboSyncSettingsServerFn = createServerFn({
	method: "GET",
})
	.middleware([requiredSessionMiddleware])
	.handler(async ({ context }) => {
		return runShelfEffect(
			ShelfService.listShelfKoboSyncSettings(context.session.user.id),
		);
	});

export const setShelfKoboSyncServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.validator(validateInput(SetShelfKoboSyncInput))
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.setShelfKoboSync({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				enabled: data.enabled,
			}),
		);
	});
