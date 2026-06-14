import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import {
	searchAuthors,
	searchIdentifierTypes,
	searchLanguages,
	searchPublishers,
	searchSeries,
	searchTags,
} from "#/features/books/services/AutocompleteService";
import { AppLayer } from "#/shared/layers/AppLayer";

interface AutocompleteInput {
	query: string;
	limit?: number;
}

export const searchAuthorsServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			searchAuthors(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});

export const searchTagsServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			searchTags(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});

export const searchSeriesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			searchSeries(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});

export const searchPublishersServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			searchPublishers(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});

export const searchLanguagesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			searchLanguages(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});

export const searchIdentifierTypesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			searchIdentifierTypes(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});
