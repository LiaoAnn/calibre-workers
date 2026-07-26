import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AutocompleteService } from "#/features/books/services/AutocompleteService";
import { BookService } from "#/features/books/services/BookService";
import { runTest } from "#/shared/test/helpers";

// Seed through the real upload path so the tests stay coupled to observable
// behaviour (what a user creating books produces) rather than table layout.
const uploadBook = (
	input: Partial<Parameters<typeof BookService.createBookFromUpload>[0]>,
) =>
	BookService.createBookFromUpload({
		title: input.title ?? "Book",
		authors: input.authors ?? ["Author"],
		fileName: "book.epub",
		size: 1,
		...input,
	});

describe("AutocompleteService", () => {
	it("AutocompleteService.searchAuthors splits comma-separated authors and de-duplicates", async () => {
		await runTest(
			Effect.gen(function* () {
				yield* uploadBook({ authors: ["Isaac Asimov", "Robert Heinlein"] });
				yield* uploadBook({ authors: ["Isaac Asimov"] });
				yield* uploadBook({ authors: ["Arthur C. Clarke"] });
			}),
		);

		expect(await runTest(AutocompleteService.searchAuthors("asimov"))).toEqual([
			"Isaac Asimov",
		]);
		expect(await runTest(AutocompleteService.searchAuthors(""))).toEqual([
			"Arthur C. Clarke",
			"Isaac Asimov",
			"Robert Heinlein",
		]);
	});

	it("AutocompleteService.searchAuthors respects the limit", async () => {
		await runTest(uploadBook({ authors: ["Aaa", "Bbb", "Ccc", "Ddd"] }));
		expect(
			await runTest(AutocompleteService.searchAuthors("", 2)),
		).toHaveLength(2);
	});

	it("AutocompleteService.searchTags matches by substring", async () => {
		await runTest(uploadBook({ tags: ["science-fiction", "fantasy"] }));
		expect(await runTest(AutocompleteService.searchTags("fic"))).toEqual([
			"science-fiction",
		]);
	});

	it("AutocompleteService.searchSeries and AutocompleteService.searchPublishers match by substring", async () => {
		await runTest(
			uploadBook({ series: "Foundation", publisher: "Gnome Press" }),
		);
		expect(await runTest(AutocompleteService.searchSeries("found"))).toEqual([
			"Foundation",
		]);
		expect(
			await runTest(AutocompleteService.searchPublishers("gnome")),
		).toEqual(["Gnome Press"]);
	});

	it("AutocompleteService.searchLanguages returns distinct languages", async () => {
		await runTest(
			Effect.gen(function* () {
				yield* uploadBook({ language: "en" });
				yield* uploadBook({ language: "en" });
				yield* uploadBook({ language: "fr" });
			}),
		);
		expect(await runTest(AutocompleteService.searchLanguages(""))).toEqual([
			"en",
			"fr",
		]);
	});

	it("AutocompleteService.searchIdentifierTypes returns distinct types", async () => {
		await runTest(
			uploadBook({
				identifiers: [
					{ type: "isbn", value: "1" },
					{ type: "isbn", value: "2" },
					{ type: "asin", value: "3" },
				],
			}),
		);
		expect(
			(await runTest(AutocompleteService.searchIdentifierTypes(""))).sort(),
		).toEqual(["asin", "isbn"]);
	});
});
