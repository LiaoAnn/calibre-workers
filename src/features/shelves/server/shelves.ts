import type { SqlError } from "@effect/sql/SqlError";
import { createServerFn } from "@tanstack/react-start";
import type { Effect } from "effect";
import type {
	InvalidShelfName,
	ShelfAccessDenied,
	ShelfNotFound,
} from "#/features/shelves/services/ShelfService";
import { ShelfService } from "#/features/shelves/services/ShelfService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import type { AppServices } from "#/shared/layers/AppLayer";
import { runServerEffect } from "#/shared/server/runServerEffect";

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

interface SetShelfKoboSyncInput extends ShelfByIdInput {
	enabled: boolean;
}

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
	.inputValidator((input: BookShelfIdsInput) => input)
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
	.inputValidator((input: CreateShelfInput) => input)
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
	.inputValidator((input: ShelfBooksInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.listShelfBooks({
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
			ShelfService.updateShelf({
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
			ShelfService.deleteShelf({
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
			ShelfService.addBooksToShelf({
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
	.inputValidator((input: SetShelfKoboSyncInput) => input)
	.handler(async ({ data, context }) => {
		return runShelfEffect(
			ShelfService.setShelfKoboSync({
				userId: context.session.user.id,
				shelfId: data.shelfId,
				enabled: data.enabled,
			}),
		);
	});
