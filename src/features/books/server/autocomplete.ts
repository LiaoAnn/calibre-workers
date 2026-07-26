import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { AutocompleteService } from "#/features/books/services/AutocompleteService";
import { ServerRuntime } from "#/shared/layers/AppRuntime";

interface AutocompleteInput {
	query: string;
	limit?: number;
}

export const searchAuthorsServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return ServerRuntime.runPromise(
			AutocompleteService.searchAuthors(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);
	});

export const searchTagsServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return ServerRuntime.runPromise(
			AutocompleteService.searchTags(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);
	});

export const searchSeriesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return ServerRuntime.runPromise(
			AutocompleteService.searchSeries(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);
	});

export const searchPublishersServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return ServerRuntime.runPromise(
			AutocompleteService.searchPublishers(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);
	});

export const searchLanguagesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return ServerRuntime.runPromise(
			AutocompleteService.searchLanguages(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);
	});

export const searchIdentifierTypesServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: AutocompleteInput) => input)
	.handler(async ({ data }) => {
		return ServerRuntime.runPromise(
			AutocompleteService.searchIdentifierTypes(data.query, data.limit).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);
	});
