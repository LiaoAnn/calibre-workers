import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import * as schema from "#/db/schema";
import { DatabaseContext } from "#/layers/DatabaseLayer";
import { searchPublishers } from "#/services/AutocompleteService";
import {
	createBookFromUpload,
	createMetadataJob,
	deleteBook,
	failStaleMetadataTasks,
	getBookById,
	getBookMetadataForProcess,
	getMetadataJob,
	listBookFilesForMetadataSync,
	listBooks,
	setBookFilesMetadataStatus,
	updateBook,
	updateMetadataJobStatus,
} from "#/services/BookService";
import { runTest, runTestExit, seedBook, seedUser } from "#/test/helpers";

describe("BookService", () => {
	describe("createBookFromUpload", () => {
		it("creates the book, file, tags, publisher, series, identifiers and description", async () => {
			const created = await runTest(
				createBookFromUpload({
					title: "Dune",
					authors: ["Frank Herbert", "Brian Herbert"],
					description: "A desert epic.",
					publisher: "Chilton",
					tags: ["sci-fi", "classic"],
					language: "en",
					series: "Dune Saga",
					seriesIndex: 1,
					identifiers: [{ type: "isbn", value: "9780441013593" }],
					fileName: "dune.epub",
					size: 4096,
				}),
			);

			const book = await runTest(getBookById(created.book.id));

			expect(book.title).toBe("Dune");
			expect(book.authors).toBe("Frank Herbert, Brian Herbert");
			expect(book.publisher?.name).toBe("Chilton");
			expect(book.series?.name).toBe("Dune Saga");
			expect(book.tags.map((t) => t.name).sort()).toEqual([
				"classic",
				"sci-fi",
			]);
			expect(book.identifiers).toHaveLength(1);
			expect(book.identifiers[0]?.value).toBe("9780441013593");
			expect(book.comments[0]?.text).toBe("A desert epic.");
			expect(book.files).toHaveLength(1);
			expect(book.files[0]?.format).toBe("epub");
			expect(book.files[0]?.id).toBe(created.file.id);
		});

		it("reuses an existing publisher instead of duplicating it", async () => {
			const { bookA, bookB, publisherSuggestions } = await runTest(
				Effect.gen(function* () {
					const a = yield* createBookFromUpload({
						title: "A",
						authors: ["X"],
						publisher: "Shared Press",
						fileName: "a.epub",
						size: 1,
					});
					const b = yield* createBookFromUpload({
						title: "B",
						authors: ["Y"],
						publisher: "Shared Press",
						fileName: "b.epub",
						size: 1,
					});
					const bookA = yield* getBookById(a.book.id);
					const bookB = yield* getBookById(b.book.id);
					// Autocomplete returns one entry per distinct publisher — a duplicate
					// publisher would surface twice here.
					const publisherSuggestions = yield* searchPublishers("Shared");
					return { bookA, bookB, publisherSuggestions };
				}),
			);

			expect(bookA.publisher?.name).toBe("Shared Press");
			expect(bookB.publisher?.name).toBe("Shared Press");
			expect(publisherSuggestions).toEqual(["Shared Press"]);
		});

		it("infers the file format from the file extension", async () => {
			const created = await runTest(
				createBookFromUpload({
					title: "Mobi Book",
					authors: ["Z"],
					fileName: "book.azw3",
					size: 10,
				}),
			);
			const book = await runTest(getBookById(created.book.id));
			expect(book.files[0]?.format).toBe("azw3");
		});
	});

	describe("listBooks", () => {
		it("paginates and reports the total", async () => {
			await runTest(
				Effect.gen(function* () {
					for (let i = 0; i < 3; i++) {
						yield* seedBook({ title: `Book ${i}` });
					}
				}),
			);

			const firstPage = await runTest(listBooks({ page: 1, limit: 2 }));
			expect(firstPage.total).toBe(3);
			expect(firstPage.items).toHaveLength(2);

			const secondPage = await runTest(listBooks({ page: 2, limit: 2 }));
			expect(secondPage.items).toHaveLength(1);
		});

		it("filters by author", async () => {
			await runTest(
				Effect.gen(function* () {
					yield* seedBook({ title: "Match", authors: "Ursula K. Le Guin" });
					yield* seedBook({ title: "Other", authors: "Someone Else" });
				}),
			);

			const result = await runTest(listBooks({ author: "Ursula K. Le Guin" }));
			expect(result.total).toBe(1);
			expect(result.items[0]?.title).toBe("Match");
		});
	});

	describe("getBookById", () => {
		it("fails with BookNotFound for an unknown id", async () => {
			const exit = await runTestExit(getBookById("does-not-exist"));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Exit.causeOption(exit);
				expect(JSON.stringify(error)).toContain("BookNotFound");
			}
		});
	});

	describe("updateBook", () => {
		it("replaces tags, identifiers and description", async () => {
			const created = await runTest(
				createBookFromUpload({
					title: "Original",
					authors: ["Author One"],
					tags: ["old-tag"],
					identifiers: [{ type: "isbn", value: "111" }],
					description: "old description",
					fileName: "x.epub",
					size: 1,
				}),
			);

			await runTest(
				updateBook({
					bookId: created.book.id,
					title: "Updated",
					authors: ["Author Two"],
					tags: ["new-tag"],
					identifiers: [{ type: "asin", value: "222" }],
					description: "new description",
				}),
			);

			const book = await runTest(getBookById(created.book.id));
			expect(book.title).toBe("Updated");
			expect(book.authors).toBe("Author Two");
			expect(book.tags.map((t) => t.name)).toEqual(["new-tag"]);
			expect(book.identifiers).toHaveLength(1);
			expect(book.identifiers[0]?.value).toBe("222");
			expect(book.comments[0]?.text).toBe("new description");
		});
	});

	describe("deleteBook", () => {
		it("cascade-deletes the book and its files", async () => {
			const created = await runTest(
				createBookFromUpload({
					title: "Doomed",
					authors: ["A"],
					tags: ["t"],
					fileName: "d.epub",
					size: 1,
				}),
			);

			await runTest(deleteBook(created.book.id));

			const exit = await runTestExit(getBookById(created.book.id));
			expect(Exit.isFailure(exit)).toBe(true);

			// The deleted book no longer appears in listings either.
			const listing = await runTest(listBooks());
			expect(listing.items.some((b) => b.id === created.book.id)).toBe(false);
		});
	});

	describe("metadata jobs", () => {
		it("creates a job and transitions its status", async () => {
			const { jobId } = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser();
					const bookId = yield* seedBook();
					return yield* createMetadataJob({ bookId, userId });
				}),
			);

			const pending = await runTest(getMetadataJob(jobId));
			expect(pending.status).toBe("pending");

			await runTest(
				updateMetadataJobStatus(jobId, {
					status: "failed",
					errorMessage: "boom",
				}),
			);

			const failed = await runTest(getMetadataJob(jobId));
			expect(failed.status).toBe("failed");
			expect(failed.errorMessage).toBe("boom");
		});

		it("failStaleMetadataTasks fails only jobs older than the cutoff", async () => {
			const oldDate = new Date(Date.now() - 60 * 60 * 1000);
			const { staleJobId, freshJobId } = await runTest(
				Effect.gen(function* () {
					const db = yield* DatabaseContext;
					const userId = yield* seedUser();
					const bookId = yield* seedBook();

					const staleJobId = crypto.randomUUID();
					yield* db.insert(schema.metadataJobs).values({
						id: staleJobId,
						bookId,
						userId,
						status: "processing",
						updatedAt: oldDate,
					});

					const fresh = yield* createMetadataJob({ bookId, userId });
					return { staleJobId, freshJobId: fresh.jobId };
				}),
			);

			const result = await runTest(
				failStaleMetadataTasks({
					staleBefore: new Date(Date.now() - 30 * 60 * 1000),
					errorMessage: "stale",
				}),
			);
			expect(result.affectedCount).toBe(1);

			const stale = await runTest(getMetadataJob(staleJobId));
			const fresh = await runTest(getMetadataJob(freshJobId));
			expect(stale.status).toBe("failed");
			expect(fresh.status).toBe("pending");
		});
	});

	describe("metadata sync status", () => {
		it("exposes process metadata and updates the file sync status", async () => {
			const created = await runTest(
				createBookFromUpload({
					title: "Meta Book",
					authors: ["First Author", "Second Author"],
					publisher: "Meta Pub",
					language: "en",
					hasCover: true,
					fileName: "meta.epub",
					size: 1,
				}),
			);

			const meta = await runTest(getBookMetadataForProcess(created.book.id));
			expect(meta.title).toBe("Meta Book");
			expect(meta.authors).toEqual(["First Author", "Second Author"]);
			expect(meta.publisher).toBe("Meta Pub");
			expect(meta.language).toBe("en");
			expect(meta.hasCover).toBe(true);

			const files = await runTest(
				listBookFilesForMetadataSync(created.book.id),
			);
			expect(files.map((f) => f.fileId)).toContain(created.file.id);

			await runTest(
				setBookFilesMetadataStatus({
					bookId: created.book.id,
					status: "pending",
				}),
			);

			const book = await runTest(getBookById(created.book.id));
			expect(book.files[0]?.metadataStatus).toBe("pending");
		});
	});
});
