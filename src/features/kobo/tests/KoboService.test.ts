import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
	KoboService,
	parseKoboSyncTokenFromHeaders,
	setSyncTokenHeader,
} from "#/features/kobo/services/KoboService";
import { ShelfService } from "#/features/shelves/services/ShelfService";
import {
	runTest,
	runTestExit,
	seedBook,
	seedBookFile,
	seedUser,
} from "#/shared/test/helpers";

const emptySyncToken = () => parseKoboSyncTokenFromHeaders(new Headers());
const ORIGIN = "http://localhost:8787";

describe("KoboService", () => {
	describe("auth tokens", () => {
		it("issues a fresh token and revokes the previous one", async () => {
			const tokens = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser();
					yield* KoboService.createKoboAuthToken(userId);
					yield* KoboService.createKoboAuthToken(userId);
					return yield* KoboService.listKoboAuthTokensForUser(userId);
				}),
			);

			expect(tokens).toHaveLength(2);
			expect(tokens.filter((t) => t.revokedAt === null)).toHaveLength(1);
			expect(tokens.filter((t) => t.revokedAt !== null)).toHaveLength(1);
		});

		it("revokes the active token on request", async () => {
			const tokens = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser();
					yield* KoboService.createKoboAuthToken(userId);
					yield* KoboService.revokeKoboAuthToken({ userId });
					return yield* KoboService.listKoboAuthTokensForUser(userId);
				}),
			);
			expect(tokens).toHaveLength(1);
			expect(tokens[0]?.revokedAt).not.toBeNull();
		});
	});

	describe("KoboService.getBookByUuid", () => {
		it("returns the book and fails with KoboBookNotFound otherwise", async () => {
			const uuid = crypto.randomUUID();
			await runTest(seedBook({ uuid, title: "Found" }));

			const book = await runTest(KoboService.getBookByUuid(uuid));
			expect(book.title).toBe("Found");

			const exit = await runTestExit(KoboService.getBookByUuid("nope"));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(Exit.causeOption(exit))).toContain(
					"KoboBookNotFound",
				);
			}
		});
	});

	describe("KoboService.getDownloadFileForKobo", () => {
		it("returns the exact format when present", async () => {
			const result = await runTest(
				Effect.gen(function* () {
					const bookId = yield* seedBook();
					yield* seedBookFile(bookId, { format: "kepub" });
					return yield* KoboService.getDownloadFileForKobo({
						bookId,
						requestedFormat: "kepub",
					});
				}),
			);
			expect(result.file.format).toBe("kepub");
			expect(result.fallbackToEpub).toBe(false);
		});

		it("falls back to epub for a kepub request and flags conversion source", async () => {
			const { result, epubFileId } = await runTest(
				Effect.gen(function* () {
					const bookId = yield* seedBook();
					const epubFileId = yield* seedBookFile(bookId, { format: "epub" });
					const result = yield* KoboService.getDownloadFileForKobo({
						bookId,
						requestedFormat: "kepub",
					});
					return { result, epubFileId };
				}),
			);
			expect(result.file.format).toBe("epub");
			expect(result.fallbackToEpub).toBe(true);
			expect(result.conversionSourceFileId).toBe(epubFileId);
		});

		it("fails with KoboFileNotFound when no usable file exists", async () => {
			const exit = await runTestExit(
				Effect.gen(function* () {
					const bookId = yield* seedBook();
					return yield* KoboService.getDownloadFileForKobo({
						bookId,
						requestedFormat: "kepub",
					});
				}),
			);
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				expect(JSON.stringify(Exit.causeOption(exit))).toContain(
					"KoboFileNotFound",
				);
			}
		});
	});

	describe("KoboService.getBookMetadataByUuid", () => {
		it("returns Kobo metadata with a download url", async () => {
			const result = await runTest(
				Effect.gen(function* () {
					const uuid = crypto.randomUUID();
					const bookId = yield* seedBook({ uuid, title: "Downloadable" });
					yield* seedBookFile(bookId, { format: "kepub" });
					return yield* KoboService.getBookMetadataByUuid({
						bookUuid: uuid,
						origin: ORIGIN,
						token: "token",
					});
				}),
			);

			expect(result.Title).toBe("Downloadable");
			expect(result.DownloadUrls.length).toBeGreaterThanOrEqual(1);
			expect(result.DownloadUrls[0]?.Format).toBe("KEPUB");
		});
	});

	describe("reading state", () => {
		it("updates status, bookmark and statistics then reads them back", async () => {
			const uuid = crypto.randomUUID();
			const { update, state } = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser();
					yield* seedBook({ uuid });
					const update = yield* KoboService.updateReadingStateByBookUuid({
						userId,
						bookUuid: uuid,
						payload: {
							ReadingStates: [
								{
									StatusInfo: { Status: "Reading" },
									CurrentBookmark: { ProgressPercent: 42 },
									Statistics: { SpentReadingMinutes: 15 },
								},
							],
						},
					});
					const state = yield* KoboService.getReadingStateResponseByBookUuid({
						userId,
						bookUuid: uuid,
					});
					return { update, state };
				}),
			);

			expect(update.RequestResult).toBe("Success");
			expect(update.UpdateResults[0]?.EntitlementId).toBe(uuid);
			expect(state).toHaveLength(1);
			expect(state[0]?.StatusInfo.Status).toBe("Reading");
			expect(state[0]?.StatusInfo.TimesStartedReading).toBe(1);
			expect(state[0]?.CurrentBookmark.ProgressPercent).toBe(42);
			expect(state[0]?.Statistics.SpentReadingMinutes).toBe(15);
		});
	});

	describe("archive", () => {
		it("archives and then unarchives a book", async () => {
			const uuid = crypto.randomUUID();
			const { archived, bookId } = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser();
					const bookId = yield* seedBook({ uuid });
					const archived = yield* KoboService.setArchivedBookByUuid({
						userId,
						bookUuid: uuid,
						isArchived: true,
					});
					yield* KoboService.unarchiveBooksForKoboSync({
						userId,
						bookIds: [bookId],
					});
					return { archived, bookId };
				}),
			);
			expect(archived.success).toBe(true);
			expect(archived.bookId).toBe(bookId);
		});
	});

	describe("KoboService.createMissingKepubConversionJobs", () => {
		it("creates a job once and de-duplicates against pending jobs", async () => {
			const { first, second } = await runTest(
				Effect.gen(function* () {
					const bookId = yield* seedBook();
					const sourceFileId = yield* seedBookFile(bookId, { format: "epub" });
					const request = [{ bookId, sourceFileId }];
					const first =
						yield* KoboService.createMissingKepubConversionJobs(request);
					const second =
						yield* KoboService.createMissingKepubConversionJobs(request);
					return { first, second };
				}),
			);
			expect(first).toHaveLength(1);
			expect(second).toHaveLength(0);
		});
	});

	describe("Kobo tags", () => {
		it("creates a tag holding a book, then renames and deletes it", async () => {
			const { tag, booksOnTag, afterRename, afterDelete } = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser();
					const uuid = crypto.randomUUID();
					yield* seedBook({ uuid, title: "Tagged" });

					const tag = yield* KoboService.createOrUpdateKoboTag({
						userId,
						name: "Favorites",
						revisionIds: [uuid],
					});
					const booksOnTag = yield* ShelfService.listShelfBooks({
						userId,
						shelfId: tag.tagId,
					});

					yield* KoboService.renameKoboTag({
						userId,
						tagId: tag.tagId,
						name: "Best",
					});
					const afterRename = yield* ShelfService.listShelves(userId);

					yield* KoboService.deleteKoboTag({ userId, tagId: tag.tagId });
					const afterDelete = yield* ShelfService.listShelves(userId);

					return { tag, booksOnTag, afterRename, afterDelete };
				}),
			);

			expect(tag.created).toBe(true);
			expect(tag.unknownRevisionIds).toEqual([]);
			expect(booksOnTag.items.map((i) => i.book.title)).toContain("Tagged");
			expect(afterRename.some((s) => s.name === "Best")).toBe(true);
			expect(afterDelete.some((s) => s.id === tag.tagId)).toBe(false);
		});
	});

	describe("sync token headers", () => {
		it("round-trips a sync token through request headers", async () => {
			const headers = new Headers();
			const token = emptySyncToken();
			setSyncTokenHeader(headers, token);
			const parsed = parseKoboSyncTokenFromHeaders(headers);

			expect(parsed.rawKoboStoreToken).toBe(token.rawKoboStoreToken);
			expect(parsed.readingStateLastModified).toBeInstanceOf(Date);
		});
	});

	describe("KoboService.buildLocalLibrarySync", () => {
		it("syncs books from a Kobo-enabled shelf and is idempotent", async () => {
			const { first, second } = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser();
					const shelf = yield* ShelfService.createShelf({
						userId,
						name: "Kobo Shelf",
					});
					yield* ShelfService.setShelfKoboSync({
						userId,
						shelfId: shelf.id,
						enabled: true,
					});
					const bookId = yield* seedBook({ title: "Synced Book" });
					yield* seedBookFile(bookId, { format: "epub" });
					yield* ShelfService.addBooksToShelf({
						userId,
						shelfId: shelf.id,
						bookIds: [bookId],
					});

					const first = yield* KoboService.buildLocalLibrarySync({
						userId,
						token: "kobo-token",
						origin: ORIGIN,
						syncToken: emptySyncToken(),
					});
					// Re-sync with the token returned by the first sync.
					const second = yield* KoboService.buildLocalLibrarySync({
						userId,
						token: "kobo-token",
						origin: ORIGIN,
						syncToken: first.syncToken,
					});
					return { first, second };
				}),
			);

			expect(first.syncResults.length).toBeGreaterThanOrEqual(1);
			expect(typeof first.continueSync).toBe("boolean");
			// An unchanged library produces no further sync entitlements.
			expect(second.syncResults).toHaveLength(0);
		});
	});
});
