import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";
import { AutocompleteService } from "#/features/books/services/AutocompleteService";
import { runServerEffect } from "#/shared/server/runServerEffect";
import { validateInput } from "#/shared/server/validateInput";

// These feed `LIKE` patterns, so an oversized query is a cheap way to make the
// database do a lot of work; cap it at the boundary.
const AutocompleteInput = Schema.Struct({
	query: Schema.String.pipe(Schema.maxLength(200)),
	limit: Schema.optional(
		Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
	),
});

export const searchAuthorsServerFn = createServerFn({ method: "GET" })
	.validator(validateInput(AutocompleteInput))
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchAuthors(data.query, data.limit),
		);
	});

export const searchTagsServerFn = createServerFn({ method: "GET" })
	.validator(validateInput(AutocompleteInput))
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchTags(data.query, data.limit),
		);
	});

export const searchSeriesServerFn = createServerFn({ method: "GET" })
	.validator(validateInput(AutocompleteInput))
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchSeries(data.query, data.limit),
		);
	});

export const searchPublishersServerFn = createServerFn({ method: "GET" })
	.validator(validateInput(AutocompleteInput))
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchPublishers(data.query, data.limit),
		);
	});

export const searchLanguagesServerFn = createServerFn({ method: "GET" })
	.validator(validateInput(AutocompleteInput))
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchLanguages(data.query, data.limit),
		);
	});

export const searchIdentifierTypesServerFn = createServerFn({ method: "GET" })
	.validator(validateInput(AutocompleteInput))
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchIdentifierTypes(data.query, data.limit),
		);
	});
