import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
	addBooksToShelf,
	createShelf,
	deleteShelf,
	listBookShelfIds,
	listShelfBooks,
	listShelfKoboSyncSettings,
	listShelves,
	removeBookFromShelf,
	setShelfKoboSync,
	updateShelf,
} from "#/features/shelves/services/ShelfService";
import {
	runTest,
	runTestExit,
	seedBook,
	seedUser,
} from "#/shared/test/helpers";

describe("ShelfService", () => {
	it("creates a shelf with the creator as owner and lists it", async () => {
		const { userId, shelf } = await runTest(
			Effect.gen(function* () {
				const userId = yield* seedUser();
				const shelf = yield* createShelf({ userId, name: "  My Shelf  " });
				return { userId, shelf };
			}),
		);

		expect(shelf.name).toBe("My Shelf"); // trimmed
		expect(shelf.bookCount).toBe(0);

		const list = await runTest(listShelves(userId));
		expect(list).toHaveLength(1);
		expect(list[0]?.id).toBe(shelf.id);
	});

	it("rejects an empty shelf name with InvalidShelfName", async () => {
		const exit = await runTestExit(
			Effect.gen(function* () {
				const userId = yield* seedUser();
				return yield* createShelf({ userId, name: "   " });
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(JSON.stringify(Exit.causeOption(exit))).toContain(
				"InvalidShelfName",
			);
		}
	});

	it("adds books, reporting added / skipped / missing counts", async () => {
		const { userId, shelfId, bookA, bookB } = await runTest(
			Effect.gen(function* () {
				const userId = yield* seedUser();
				const shelf = yield* createShelf({ userId, name: "Reading" });
				const bookA = yield* seedBook({ title: "A" });
				const bookB = yield* seedBook({ title: "B" });
				return { userId, shelfId: shelf.id, bookA, bookB };
			}),
		);

		const first = await runTest(
			addBooksToShelf({
				userId,
				shelfId,
				bookIds: [bookA, bookB, "missing-book-id"],
			}),
		);
		expect(first.addedCount).toBe(2);
		expect(first.missingBookIds).toEqual(["missing-book-id"]);

		// Re-adding the same books skips them.
		const second = await runTest(
			addBooksToShelf({ userId, shelfId, bookIds: [bookA] }),
		);
		expect(second.addedCount).toBe(0);
		expect(second.skippedCount).toBe(1);

		const books = await runTest(listShelfBooks({ userId, shelfId }));
		expect(books.total).toBe(2);
		expect(books.items).toHaveLength(2);
	});

	it("removes a book from a shelf", async () => {
		const { userId, shelfId, bookId } = await runTest(
			Effect.gen(function* () {
				const userId = yield* seedUser();
				const shelf = yield* createShelf({ userId, name: "S" });
				const bookId = yield* seedBook();
				yield* addBooksToShelf({
					userId,
					shelfId: shelf.id,
					bookIds: [bookId],
				});
				return { userId, shelfId: shelf.id, bookId };
			}),
		);

		await runTest(removeBookFromShelf({ userId, shelfId, bookId }));
		const books = await runTest(listShelfBooks({ userId, shelfId }));
		expect(books.total).toBe(0);
	});

	it("lists the shelf ids a book belongs to for a user", async () => {
		const { userId, shelfId, bookId } = await runTest(
			Effect.gen(function* () {
				const userId = yield* seedUser();
				const shelf = yield* createShelf({ userId, name: "Owned" });
				const bookId = yield* seedBook();
				yield* addBooksToShelf({
					userId,
					shelfId: shelf.id,
					bookIds: [bookId],
				});
				return { userId, shelfId: shelf.id, bookId };
			}),
		);

		const shelfIds = await runTest(listBookShelfIds({ userId, bookId }));
		expect(shelfIds).toEqual([shelfId]);
	});

	it("soft-deletes a shelf so it no longer appears in listings", async () => {
		const { userId, shelfId } = await runTest(
			Effect.gen(function* () {
				const userId = yield* seedUser();
				const shelf = yield* createShelf({ userId, name: "Temp" });
				return { userId, shelfId: shelf.id };
			}),
		);

		await runTest(deleteShelf({ userId, shelfId }));
		const list = await runTest(listShelves(userId));
		expect(list).toHaveLength(0);
	});

	it("denies access when a non-owner mutates the shelf", async () => {
		const { otherUserId, shelfId } = await runTest(
			Effect.gen(function* () {
				const ownerId = yield* seedUser();
				const otherUserId = yield* seedUser();
				const shelf = yield* createShelf({ userId: ownerId, name: "Private" });
				return { otherUserId, shelfId: shelf.id };
			}),
		);

		const exit = await runTestExit(
			updateShelf({ userId: otherUserId, shelfId, name: "Hijacked" }),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(JSON.stringify(Exit.causeOption(exit))).toContain(
				"ShelfAccessDenied",
			);
		}
	});

	it("toggles Kobo sync settings for an owned shelf", async () => {
		const { userId, shelfId } = await runTest(
			Effect.gen(function* () {
				const userId = yield* seedUser();
				const shelf = yield* createShelf({ userId, name: "Synced" });
				return { userId, shelfId: shelf.id };
			}),
		);

		await runTest(setShelfKoboSync({ userId, shelfId, enabled: true }));
		let settings = await runTest(listShelfKoboSyncSettings(userId));
		expect(settings[0]?.enableKoboSync).toBe(true);

		await runTest(setShelfKoboSync({ userId, shelfId, enabled: false }));
		settings = await runTest(listShelfKoboSyncSettings(userId));
		expect(settings[0]?.enableKoboSync).toBe(false);
	});
});
