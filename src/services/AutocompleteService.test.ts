import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	searchAuthors,
	searchIdentifierTypes,
	searchLanguages,
	searchPublishers,
	searchSeries,
	searchTags,
} from "#/services/AutocompleteService";
import { createBookFromUpload } from "#/services/BookService";
import { runTest } from "#/test/helpers";

// Seed through the real upload path so the tests stay coupled to observable
// behaviour (what a user creating books produces) rather than table layout.
const uploadBook = (
	input: Partial<Parameters<typeof createBookFromUpload>[0]>,
) =>
	createBookFromUpload({
		title: input.title ?? "Book",
		authors: input.authors ?? ["Author"],
		fileName: "book.epub",
		size: 1,
		...input,
	});

describe("AutocompleteService", () => {
	it("searchAuthors splits comma-separated authors and de-duplicates", async () => {
		await runTest(
			Effect.gen(function* () {
				yield* uploadBook({ authors: ["Isaac Asimov", "Robert Heinlein"] });
				yield* uploadBook({ authors: ["Isaac Asimov"] });
				yield* uploadBook({ authors: ["Arthur C. Clarke"] });
			}),
		);

		expect(await runTest(searchAuthors("asimov"))).toEqual(["Isaac Asimov"]);
		expect(await runTest(searchAuthors(""))).toEqual([
			"Arthur C. Clarke",
			"Isaac Asimov",
			"Robert Heinlein",
		]);
	});

	it("searchAuthors respects the limit", async () => {
		await runTest(uploadBook({ authors: ["Aaa", "Bbb", "Ccc", "Ddd"] }));
		expect(await runTest(searchAuthors("", 2))).toHaveLength(2);
	});

	it("searchTags matches by substring", async () => {
		await runTest(uploadBook({ tags: ["science-fiction", "fantasy"] }));
		expect(await runTest(searchTags("fic"))).toEqual(["science-fiction"]);
	});

	it("searchSeries and searchPublishers match by substring", async () => {
		await runTest(
			uploadBook({ series: "Foundation", publisher: "Gnome Press" }),
		);
		expect(await runTest(searchSeries("found"))).toEqual(["Foundation"]);
		expect(await runTest(searchPublishers("gnome"))).toEqual(["Gnome Press"]);
	});

	it("searchLanguages returns distinct languages", async () => {
		await runTest(
			Effect.gen(function* () {
				yield* uploadBook({ language: "en" });
				yield* uploadBook({ language: "en" });
				yield* uploadBook({ language: "fr" });
			}),
		);
		expect(await runTest(searchLanguages(""))).toEqual(["en", "fr"]);
	});

	it("searchIdentifierTypes returns distinct types", async () => {
		await runTest(
			uploadBook({
				identifiers: [
					{ type: "isbn", value: "1" },
					{ type: "isbn", value: "2" },
					{ type: "asin", value: "3" },
				],
			}),
		);
		expect((await runTest(searchIdentifierTypes(""))).sort()).toEqual([
			"asin",
			"isbn",
		]);
	});
});
