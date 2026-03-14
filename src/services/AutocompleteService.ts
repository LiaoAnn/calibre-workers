import "@tanstack/react-start/server-only";

import { isNotNull, like } from "drizzle-orm";
import { Effect } from "effect";
import * as schema from "#/db/schema";
import { DatabaseContext } from "#/layers/DatabaseLayer";

const DEFAULT_LIMIT = 20;

/**
 * Search for unique author names from the books table.
 * Authors are stored as comma-separated strings, so we need to split and deduplicate.
 */
export const searchAuthors = (query: string, limit = DEFAULT_LIMIT) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

		// Get all non-null authors strings from books
		const rows = yield* database
			.select({ authors: schema.books.authors })
			.from(schema.books)
			.where(isNotNull(schema.books.authors));

		// Split by comma, trim, deduplicate, and filter by query
		const authorSet = new Set<string>();
		for (const row of rows) {
			if (row.authors) {
				const names = row.authors.split(",").map((n) => n.trim());
				for (const name of names) {
					if (name) authorSet.add(name);
				}
			}
		}

		const allAuthors = Array.from(authorSet).sort();
		const lowerQuery = query.toLowerCase();

		// Filter by query if provided
		const filtered = query
			? allAuthors.filter((name) => name.toLowerCase().includes(lowerQuery))
			: allAuthors;

		return filtered.slice(0, limit);
	});

/**
 * Search for tags by name.
 */
export const searchTags = (query: string, limit = DEFAULT_LIMIT) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

		const rows = yield* database
			.select({ name: schema.tags.name })
			.from(schema.tags)
			.where(query ? like(schema.tags.name, `%${query}%`) : undefined)
			.limit(limit);

		return rows.map((r) => r.name);
	});

/**
 * Search for series by name.
 */
export const searchSeries = (query: string, limit = DEFAULT_LIMIT) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

		const rows = yield* database
			.select({ name: schema.series.name })
			.from(schema.series)
			.where(query ? like(schema.series.name, `%${query}%`) : undefined)
			.limit(limit);

		return rows.map((r) => r.name);
	});

/**
 * Search for publishers by name.
 */
export const searchPublishers = (query: string, limit = DEFAULT_LIMIT) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

		const rows = yield* database
			.select({ name: schema.publishers.name })
			.from(schema.publishers)
			.where(query ? like(schema.publishers.name, `%${query}%`) : undefined)
			.limit(limit);

		return rows.map((r) => r.name);
	});

/**
 * Search for languages from the books table.
 */
export const searchLanguages = (query: string, limit = DEFAULT_LIMIT) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

		const rows = yield* database
			.selectDistinct({ language: schema.books.language })
			.from(schema.books)
			.where(isNotNull(schema.books.language));

		const languages = rows.map((r) => r.language).filter(Boolean) as string[];
		const sorted = languages.sort();

		const filtered = query
			? sorted.filter((lang) =>
					lang.toLowerCase().includes(query.toLowerCase()),
				)
			: sorted;

		return filtered.slice(0, limit);
	});

/**
 * Search for unique identifier types from the identifiers table.
 */
export const searchIdentifierTypes = (query: string, limit = DEFAULT_LIMIT) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

		const rows = yield* database
			.selectDistinct({ type: schema.identifiers.type })
			.from(schema.identifiers)
			.where(query ? like(schema.identifiers.type, `%${query}%`) : undefined)
			.limit(limit);

		return rows.map((r) => r.type);
	});
