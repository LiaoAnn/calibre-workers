import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { AutocompleteService } from "#/features/books/services/AutocompleteService";
import { BookService } from "#/features/books/services/BookService";
import * as schema from "#/shared/db/schema";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";
import {
	runTest,
	runTestExit,
	seedBook,
	seedUser,
} from "#/shared/test/helpers";

describe("BookService", () => {
	describe("BookService.createBookFromUpload", () => {
		it("creates the book, file, tags, publisher, series, identifiers and description", async () => {
			const created = await runTest(
				BookService.createBookFromUpload({
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

			const book = await runTest(BookService.getBookById(created.book.id));

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
					const a = yield* BookService.createBookFromUpload({
						title: "A",
						authors: ["X"],
						publisher: "Shared Press",
						fileName: "a.epub",
						size: 1,
					});
					const b = yield* BookService.createBookFromUpload({
						title: "B",
						authors: ["Y"],
						publisher: "Shared Press",
						fileName: "b.epub",
						size: 1,
					});
					const bookA = yield* BookService.getBookById(a.book.id);
					const bookB = yield* BookService.getBookById(b.book.id);
					// Autocomplete returns one entry per distinct publisher — a duplicate
					// publisher would surface twice here.
					const publisherSuggestions =
						yield* AutocompleteService.searchPublishers("Shared");
					return { bookA, bookB, publisherSuggestions };
				}),
			);

			expect(bookA.publisher?.name).toBe("Shared Press");
			expect(bookB.publisher?.name).toBe("Shared Press");
			expect(publisherSuggestions).toEqual(["Shared Press"]);
		});

		it("infers the file format from the file extension", async () => {
			const created = await runTest(
				BookService.createBookFromUpload({
					title: "Mobi Book",
					authors: ["Z"],
					fileName: "book.azw3",
					size: 10,
				}),
			);
			const book = await runTest(BookService.getBookById(created.book.id));
			expect(book.files[0]?.format).toBe("azw3");
		});
	});

	describe("BookService.listBooks", () => {
		it("paginates and reports the total", async () => {
			await runTest(
				Effect.gen(function* () {
					for (let i = 0; i < 3; i++) {
						yield* seedBook({ title: `Book ${i}` });
					}
				}),
			);

			const firstPage = await runTest(
				BookService.listBooks({ page: 1, limit: 2 }),
			);
			expect(firstPage.total).toBe(3);
			expect(firstPage.items).toHaveLength(2);

			const secondPage = await runTest(
				BookService.listBooks({ page: 2, limit: 2 }),
			);
			expect(secondPage.items).toHaveLength(1);
		});

		it("filters by author", async () => {
			await runTest(
				Effect.gen(function* () {
					yield* seedBook({ title: "Match", authors: "Ursula K. Le Guin" });
					yield* seedBook({ title: "Other", authors: "Someone Else" });
				}),
			);

			const result = await runTest(
				BookService.listBooks({ author: "Ursula K. Le Guin" }),
			);
			expect(result.total).toBe(1);
			expect(result.items[0]?.title).toBe("Match");
		});
	});

	describe("BookService.getBookById", () => {
		it("fails with BookNotFound for an unknown id", async () => {
			const exit = await runTestExit(BookService.getBookById("does-not-exist"));
			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = Exit.causeOption(exit);
				expect(JSON.stringify(error)).toContain("BookNotFound");
			}
		});
	});

	describe("BookService.updateBook", () => {
		it("replaces tags, identifiers and description", async () => {
			const created = await runTest(
				BookService.createBookFromUpload({
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
				BookService.updateBook({
					bookId: created.book.id,
					title: "Updated",
					authors: ["Author Two"],
					tags: ["new-tag"],
					identifiers: [{ type: "asin", value: "222" }],
					description: "new description",
				}),
			);

			const book = await runTest(BookService.getBookById(created.book.id));
			expect(book.title).toBe("Updated");
			expect(book.authors).toBe("Author Two");
			expect(book.tags.map((t) => t.name)).toEqual(["new-tag"]);
			expect(book.identifiers).toHaveLength(1);
			expect(book.identifiers[0]?.value).toBe("222");
			expect(book.comments[0]?.text).toBe("new description");
		});
	});

	describe("BookService.deleteBook", () => {
		it("cascade-deletes the book and its files", async () => {
			const created = await runTest(
				BookService.createBookFromUpload({
					title: "Doomed",
					authors: ["A"],
					tags: ["t"],
					fileName: "d.epub",
					size: 1,
				}),
			);

			await runTest(BookService.deleteBook(created.book.id));

			const exit = await runTestExit(BookService.getBookById(created.book.id));
			expect(Exit.isFailure(exit)).toBe(true);

			// The deleted book no longer appears in listings either.
			const listing = await runTest(BookService.listBooks());
			expect(listing.items.some((b) => b.id === created.book.id)).toBe(false);
		});
	});

	describe("metadata jobs", () => {
		it("creates a job and transitions its status", async () => {
			const { jobId } = await runTest(
				Effect.gen(function* () {
					const userId = yield* seedUser();
					const bookId = yield* seedBook();
					return yield* BookService.createMetadataJob({ bookId, userId });
				}),
			);

			const pending = await runTest(BookService.getMetadataJob(jobId));
			expect(pending.status).toBe("pending");

			await runTest(
				BookService.updateMetadataJobStatus(jobId, {
					status: "failed",
					errorMessage: "boom",
				}),
			);

			const failed = await runTest(BookService.getMetadataJob(jobId));
			expect(failed.status).toBe("failed");
			expect(failed.errorMessage).toBe("boom");
		});

		it("BookService.failStaleMetadataTasks fails only jobs older than the cutoff", async () => {
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

					const fresh = yield* BookService.createMetadataJob({
						bookId,
						userId,
					});
					return { staleJobId, freshJobId: fresh.jobId };
				}),
			);

			const result = await runTest(
				BookService.failStaleMetadataTasks({
					staleBefore: new Date(Date.now() - 30 * 60 * 1000),
					errorMessage: "stale",
				}),
			);
			expect(result.affectedCount).toBe(1);

			const stale = await runTest(BookService.getMetadataJob(staleJobId));
			const fresh = await runTest(BookService.getMetadataJob(freshJobId));
			expect(stale.status).toBe("failed");
			expect(fresh.status).toBe("pending");
		});
	});

	describe("metadata sync status", () => {
		it("exposes process metadata and updates the file sync status", async () => {
			const created = await runTest(
				BookService.createBookFromUpload({
					title: "Meta Book",
					authors: ["First Author", "Second Author"],
					publisher: "Meta Pub",
					language: "en",
					hasCover: true,
					fileName: "meta.epub",
					size: 1,
				}),
			);

			const meta = await runTest(
				BookService.getBookMetadataForProcess(created.book.id),
			);
			expect(meta.title).toBe("Meta Book");
			expect(meta.authors).toEqual(["First Author", "Second Author"]);
			expect(meta.publisher).toBe("Meta Pub");
			expect(meta.language).toBe("en");
			expect(meta.hasCover).toBe(true);

			const files = await runTest(
				BookService.listBookFilesForMetadataSync(created.book.id),
			);
			expect(files.map((f) => f.fileId)).toContain(created.file.id);

			await runTest(
				BookService.setBookFilesMetadataStatus({
					bookId: created.book.id,
					status: "pending",
				}),
			);

			const book = await runTest(BookService.getBookById(created.book.id));
			expect(book.files[0]?.metadataStatus).toBe("pending");
		});
	});
});
