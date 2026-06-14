import "@tanstack/react-start/server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { unarchiveBooksForKoboSync } from "#/features/kobo/services/KoboService";
import * as schema from "#/shared/db/schema";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";

export class ShelfNotFound extends Data.TaggedError("ShelfNotFound")<{
	readonly shelfId: string;
}> {}

export class ShelfAccessDenied extends Data.TaggedError("ShelfAccessDenied")<{
	readonly shelfId: string;
	readonly userId: string;
}> {}

export class InvalidShelfName extends Data.TaggedError("InvalidShelfName")<{
	readonly reason: string;
}> {}

interface ShelfSummary {
	id: string;
	name: string;
	visibility: schema.ShelfVisibility;
	bookCount: number;
	previewBooks: Array<{
		id: string;
		title: string;
		hasCover: boolean;
		lastModified: Date;
	}>;
	createdAt: Date;
	updatedAt: Date;
}

const normalizeShelfName = (name: string) => name.trim();

const validateShelfName = (name: string) => {
	if (name.length === 0) {
		return Effect.fail(
			new InvalidShelfName({ reason: "Shelf name is required" }),
		);
	}

	if (name.length > 120) {
		return Effect.fail(
			new InvalidShelfName({ reason: "Shelf name must be at most 120 chars" }),
		);
	}

	return Effect.succeed(name);
};

const getOwnedShelf = ({
	shelfId,
	userId,
}: {
	shelfId: string;
	userId: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const rows = yield* database
			.select()
			.from(schema.shelves)
			.where(
				and(eq(schema.shelves.id, shelfId), isNull(schema.shelves.deletedAt)),
			)
			.limit(1);
		const shelf = rows[0];

		if (!shelf) {
			return yield* Effect.fail(new ShelfNotFound({ shelfId }));
		}

		const membershipRows = yield* database
			.select({ role: schema.shelfMembers.role })
			.from(schema.shelfMembers)
			.where(
				and(
					eq(schema.shelfMembers.shelfId, shelfId),
					eq(schema.shelfMembers.userId, userId),
				),
			)
			.limit(1);
		const membership = membershipRows[0];

		// TODO(shelves): expand permission matrix (owner/editor/viewer) per action.
		if (!membership || membership.role !== "owner") {
			return yield* Effect.fail(new ShelfAccessDenied({ shelfId, userId }));
		}

		return shelf;
	});

const getShelfBookCount = (shelfId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const rows = yield* database
			.select({ count: sql<number>`count(*)` })
			.from(schema.shelfBooks)
			.where(eq(schema.shelfBooks.shelfId, shelfId));
		return Number(rows[0]?.count ?? 0);
	});

export const listShelves = (userId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

		// TODO(shelves): include public/shared shelf discovery when visibility is implemented.
		const shelves = yield* database
			.select({
				id: schema.shelves.id,
				name: schema.shelves.name,
				visibility: schema.shelves.visibility,
				createdAt: schema.shelves.createdAt,
				updatedAt: schema.shelves.updatedAt,
			})
			.from(schema.shelfMembers)
			.innerJoin(
				schema.shelves,
				eq(schema.shelves.id, schema.shelfMembers.shelfId),
			)
			.where(
				and(
					eq(schema.shelfMembers.userId, userId),
					isNull(schema.shelves.deletedAt),
				),
			)
			.orderBy(desc(schema.shelves.updatedAt), asc(schema.shelves.name));

		if (shelves.length === 0) {
			return [] as ShelfSummary[];
		}

		const shelfIds = shelves.map((shelf) => shelf.id);
		const countRows = yield* database
			.select({
				shelfId: schema.shelfBooks.shelfId,
				count: sql<number>`count(*)`,
			})
			.from(schema.shelfBooks)
			.where(inArray(schema.shelfBooks.shelfId, shelfIds))
			.groupBy(schema.shelfBooks.shelfId);

		const countByShelfId = new Map(
			countRows.map((row) => [row.shelfId, Number(row.count)]),
		);

		const previewRows = yield* database
			.select({
				shelfId: schema.shelfBooks.shelfId,
				id: schema.books.id,
				title: schema.books.title,
				hasCover: schema.books.hasCover,
				lastModified: schema.books.lastModified,
			})
			.from(schema.shelfBooks)
			.innerJoin(schema.books, eq(schema.books.id, schema.shelfBooks.bookId))
			.where(inArray(schema.shelfBooks.shelfId, shelfIds))
			.orderBy(
				asc(schema.shelfBooks.shelfId),
				asc(schema.shelfBooks.order),
				desc(schema.shelfBooks.addedAt),
			);

		const previewByShelfId = new Map<string, typeof previewRows>();

		for (const row of previewRows) {
			const current = previewByShelfId.get(row.shelfId) ?? [];
			if (current.length >= 3) {
				continue;
			}

			current.push(row);
			previewByShelfId.set(row.shelfId, current);
		}

		return shelves.map(
			(shelf) =>
				({
					id: shelf.id,
					name: shelf.name,
					visibility: shelf.visibility,
					bookCount: countByShelfId.get(shelf.id) ?? 0,
					previewBooks: previewByShelfId.get(shelf.id) ?? [],
					createdAt: shelf.createdAt,
					updatedAt: shelf.updatedAt,
				}) satisfies ShelfSummary,
		);
	});

export const listShelfKoboSyncSettings = (userId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		return yield* database
			.select({
				shelfId: schema.shelves.id,
				shelfName: schema.shelves.name,
				enableKoboSync: schema.shelfMembers.enableKoboSync,
				memberRole: schema.shelfMembers.role,
				updatedAt: schema.shelfMembers.updatedAt,
			})
			.from(schema.shelfMembers)
			.innerJoin(
				schema.shelves,
				eq(schema.shelves.id, schema.shelfMembers.shelfId),
			)
			.where(
				and(
					eq(schema.shelfMembers.userId, userId),
					isNull(schema.shelves.deletedAt),
				),
			)
			.orderBy(asc(schema.shelves.name));
	});

export const setShelfKoboSync = ({
	userId,
	shelfId,
	enabled,
}: {
	userId: string;
	shelfId: string;
	enabled: boolean;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const rows = yield* database
			.select({
				enableKoboSync: schema.shelfMembers.enableKoboSync,
			})
			.from(schema.shelfMembers)
			.innerJoin(
				schema.shelves,
				eq(schema.shelves.id, schema.shelfMembers.shelfId),
			)
			.where(
				and(
					eq(schema.shelfMembers.shelfId, shelfId),
					eq(schema.shelfMembers.userId, userId),
					isNull(schema.shelves.deletedAt),
				),
			)
			.limit(1);

		const membership = rows[0];
		if (!membership) {
			return yield* Effect.fail(new ShelfAccessDenied({ shelfId, userId }));
		}

		const updateValues: Partial<typeof schema.shelfMembers.$inferInsert> = {
			enableKoboSync: enabled,
		};

		if (enabled) {
			updateValues.koboSyncDisabledAt = null;
		} else if (membership.enableKoboSync) {
			updateValues.koboSyncDisabledAt = new Date();
		}

		yield* database
			.update(schema.shelfMembers)
			.set(updateValues)
			.where(
				and(
					eq(schema.shelfMembers.shelfId, shelfId),
					eq(schema.shelfMembers.userId, userId),
				),
			);

		return { shelfId, enabled };
	});

export const listBookShelfIds = ({
	userId,
	bookId,
}: {
	userId: string;
	bookId: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const rows = yield* database
			.select({ shelfId: schema.shelfBooks.shelfId })
			.from(schema.shelfBooks)
			.innerJoin(
				schema.shelfMembers,
				and(
					eq(schema.shelfMembers.shelfId, schema.shelfBooks.shelfId),
					eq(schema.shelfMembers.userId, userId),
				),
			)
			.innerJoin(
				schema.shelves,
				eq(schema.shelves.id, schema.shelfBooks.shelfId),
			)
			.where(
				and(
					eq(schema.shelfBooks.bookId, bookId),
					isNull(schema.shelves.deletedAt),
				),
			);

		return rows.map((row) => row.shelfId);
	});

export const createShelf = ({
	userId,
	name,
	visibility = "private",
}: {
	userId: string;
	name: string;
	visibility?: schema.ShelfVisibility;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const normalizedName = yield* validateShelfName(normalizeShelfName(name));
		const now = new Date();
		const id = crypto.randomUUID();

		yield* database.insert(schema.shelves).values({
			id,
			name: normalizedName,
			visibility,
			createdAt: now,
			updatedAt: now,
		});

		yield* database.insert(schema.shelfMembers).values({
			shelfId: id,
			userId,
			role: "owner",
			addedByUserId: userId,
			koboSyncDisabledAt: null,
			createdAt: now,
			updatedAt: now,
		});

		return {
			id,
			name: normalizedName,
			visibility,
			bookCount: 0,
			previewBooks: [],
			createdAt: now,
			updatedAt: now,
		} satisfies ShelfSummary;
	});

const getShelfById = ({
	userId,
	shelfId,
}: {
	userId: string;
	shelfId: string;
}) =>
	Effect.gen(function* () {
		const shelf = yield* getOwnedShelf({ shelfId, userId });
		const bookCount = yield* getShelfBookCount(shelfId);

		return {
			id: shelf.id,
			name: shelf.name,
			visibility: shelf.visibility,
			bookCount,
			previewBooks: [],
			createdAt: shelf.createdAt,
			updatedAt: shelf.updatedAt,
		} satisfies ShelfSummary;
	});

export const updateShelf = ({
	userId,
	shelfId,
	name,
}: {
	userId: string;
	shelfId: string;
	name?: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		yield* getOwnedShelf({ shelfId, userId });

		const nextName =
			typeof name === "string"
				? yield* validateShelfName(normalizeShelfName(name))
				: undefined;
		const updateValues: Partial<typeof schema.shelves.$inferInsert> = {
			updatedAt: new Date(),
		};

		if (nextName !== undefined) {
			updateValues.name = nextName;
		}

		yield* database
			.update(schema.shelves)
			.set(updateValues)
			.where(eq(schema.shelves.id, shelfId));

		return yield* getShelfById({ userId, shelfId });
	});

export const deleteShelf = ({
	userId,
	shelfId,
}: {
	userId: string;
	shelfId: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		yield* getOwnedShelf({ shelfId, userId });

		yield* database
			.update(schema.shelves)
			.set({ deletedAt: new Date() })
			.where(eq(schema.shelves.id, shelfId));

		return { success: true };
	});

interface ShelfBookItem {
	book: typeof schema.books.$inferSelect;
	order: number;
	addedAt: Date;
}

interface ShelfBooksResult {
	shelf: ShelfSummary;
	items: ShelfBookItem[];
	total: number;
	page: number;
	limit: number;
}

export const listShelfBooks = ({
	userId,
	shelfId,
	page = 1,
	limit = 24,
}: {
	userId: string;
	shelfId: string;
	page?: number;
	limit?: number;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const shelf = yield* getShelfById({ userId, shelfId });

		const safePage = Math.max(1, page);
		const safeLimit = Math.max(1, Math.min(100, limit));
		const offset = (safePage - 1) * safeLimit;

		const rows = yield* database.query.shelfBooks.findMany({
			where: eq(schema.shelfBooks.shelfId, shelfId),
			with: { book: true },
			orderBy: [asc(schema.shelfBooks.order), desc(schema.shelfBooks.addedAt)],
			limit: safeLimit,
			offset,
		});

		const countRows = yield* database
			.select({ count: sql<number>`count(*)` })
			.from(schema.shelfBooks)
			.where(eq(schema.shelfBooks.shelfId, shelfId));

		return {
			shelf,
			items: rows
				.filter((row) => row.book)
				.map((row) => ({
					book: row.book,
					order: row.order,
					addedAt: row.addedAt,
				})),
			total: Number(countRows[0]?.count ?? 0),
			page: safePage,
			limit: safeLimit,
		} satisfies ShelfBooksResult;
	});

export const addBooksToShelf = ({
	userId,
	shelfId,
	bookIds,
}: {
	userId: string;
	shelfId: string;
	bookIds: string[];
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		yield* getOwnedShelf({ shelfId, userId });

		const normalizedBookIds = [
			...new Set(bookIds.map((id) => id.trim())),
		].filter(Boolean);
		if (normalizedBookIds.length === 0) {
			return { addedCount: 0, skippedCount: 0, missingBookIds: [] as string[] };
		}

		const existingBooks = yield* database
			.select({ id: schema.books.id })
			.from(schema.books)
			.where(inArray(schema.books.id, normalizedBookIds));
		const existingBookIdSet = new Set(existingBooks.map((row) => row.id));
		const missingBookIds = normalizedBookIds.filter(
			(id) => !existingBookIdSet.has(id),
		);
		const candidateBookIds = normalizedBookIds.filter((id) =>
			existingBookIdSet.has(id),
		);

		if (candidateBookIds.length === 0) {
			return {
				addedCount: 0,
				skippedCount: 0,
				missingBookIds,
			};
		}

		const existingLinks = yield* database
			.select({ bookId: schema.shelfBooks.bookId })
			.from(schema.shelfBooks)
			.where(
				and(
					eq(schema.shelfBooks.shelfId, shelfId),
					inArray(schema.shelfBooks.bookId, candidateBookIds),
				),
			);
		const existingLinkSet = new Set(existingLinks.map((row) => row.bookId));
		const toInsertBookIds = candidateBookIds.filter(
			(bookId) => !existingLinkSet.has(bookId),
		);

		if (toInsertBookIds.length > 0) {
			const maxOrderRows = yield* database
				.select({
					maxOrder: sql<number>`coalesce(max(${schema.shelfBooks.order}), -1)`,
				})
				.from(schema.shelfBooks)
				.where(eq(schema.shelfBooks.shelfId, shelfId));
			const maxOrder = Number(maxOrderRows[0]?.maxOrder ?? -1);

			yield* database.insert(schema.shelfBooks).values(
				toInsertBookIds.map((bookId, index) => ({
					shelfId,
					bookId,
					order: maxOrder + index + 1,
				})),
			);

			const membershipRows = yield* database
				.select({ enableKoboSync: schema.shelfMembers.enableKoboSync })
				.from(schema.shelfMembers)
				.where(
					and(
						eq(schema.shelfMembers.shelfId, shelfId),
						eq(schema.shelfMembers.userId, userId),
					),
				)
				.limit(1);

			if (membershipRows[0]?.enableKoboSync === true) {
				yield* unarchiveBooksForKoboSync({
					userId,
					bookIds: toInsertBookIds,
				});
			}

			yield* database
				.update(schema.shelves)
				.set({ updatedAt: new Date() })
				.where(eq(schema.shelves.id, shelfId));
		}

		return {
			addedCount: toInsertBookIds.length,
			skippedCount: candidateBookIds.length - toInsertBookIds.length,
			missingBookIds,
		};
	});

export const removeBookFromShelf = ({
	userId,
	shelfId,
	bookId,
}: {
	userId: string;
	shelfId: string;
	bookId: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		yield* getOwnedShelf({ shelfId, userId });

		yield* database
			.delete(schema.shelfBooks)
			.where(
				and(
					eq(schema.shelfBooks.shelfId, shelfId),
					eq(schema.shelfBooks.bookId, bookId),
				),
			);

		yield* database
			.update(schema.shelves)
			.set({ updatedAt: new Date() })
			.where(eq(schema.shelves.id, shelfId));

		return { success: true };
	});
