import { createServerFn } from "@tanstack/react-start";
import { AutocompleteService } from "#/features/books/services/AutocompleteService";
import { runServerEffect } from "#/shared/server/runServerEffect";

interface AutocompleteInput {
	query: string;
	limit?: number;
}

export const searchAuthorsServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchAuthors(data.query, data.limit),
		);
	});

export const searchTagsServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchTags(data.query, data.limit),
		);
	});

export const searchSeriesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchSeries(data.query, data.limit),
		);
	});

export const searchPublishersServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchPublishers(data.query, data.limit),
		);
	});

export const searchLanguagesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchLanguages(data.query, data.limit),
		);
	});

export const searchIdentifierTypesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return runServerEffect(
			AutocompleteService.searchIdentifierTypes(data.query, data.limit),
		);
	});
