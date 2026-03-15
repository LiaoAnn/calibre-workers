import "@tanstack/react-start/server-only";

import { desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import * as schema from "#/db/schema";
import { DatabaseContext } from "#/layers/DatabaseLayer";
import { BookNotFound } from "#/lib/errors";
import { r2Keys } from "#/lib/r2-keys";

export interface ListBooksInput {
	page?: number;
	limit?: number;
	author?: string;
}

export interface ListBooksResult {
	items: Array<typeof schema.books.$inferSelect>;
	total: number;
	page: number;
	limit: number;
}

export interface CreateBookFromUploadInput {
	title: string;
	/** Multiple authors supported. TODO: add individual author profile pages in the future */
	authors: string[];
	description?: string;
	publisher?: string;
	tags?: string[];
	language?: string;
	pubdate?: Date;
	series?: string;
	seriesIndex?: number;
	identifiers?: { type: string; value: string }[];
	fileName: string;
	mimeType?: string;
	size: number;
	hasCover?: boolean;
}

export const listBooks = ({
	page = 1,
	limit = 20,
	author,
}: ListBooksInput = {}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const safePage = Math.max(1, page);
		const safeLimit = Math.max(1, Math.min(100, limit));
		const offset = (safePage - 1) * safeLimit;
		const normalizedAuthor = author?.trim();
		const whereClause = normalizedAuthor
			? sql<boolean>`instr(',' || replace(coalesce(${schema.books.authors}, ''), ', ', ',') || ',', ',' || ${normalizedAuthor} || ',') > 0`
			: undefined;

		const items = yield* database
			.select()
			.from(schema.books)
			.where(whereClause)
			.orderBy(desc(schema.books.timestamp))
			.limit(safeLimit)
			.offset(offset);

		const countRows = yield* database
			.select({ count: sql<number>`count(*)` })
			.from(schema.books)
			.where(whereClause);

		return {
			items,
			total: Number(countRows[0]?.count ?? 0),
			page: safePage,
			limit: safeLimit,
		} satisfies ListBooksResult;
	});

export const getBookById = (bookId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		// Avoid relational query API here: with sqlite-proxy this relation mapper can
		// return undefined for empty to-many relations and crash on .map().

		// TODO: database.batch()
		const bookRows = yield* database
			.select()
			.from(schema.books)
			.where(eq(schema.books.id, bookId))
			.limit(1);

		const book = bookRows[0];
		if (!book) {
			return yield* Effect.fail(new BookNotFound({ bookId }));
		}

		const files = yield* database
			.select()
			.from(schema.bookFiles)
			.where(eq(schema.bookFiles.bookId, bookId));

		const tagRows = yield* database
			.select({ id: schema.tags.id, name: schema.tags.name })
			.from(schema.booksTagsLink)
			.innerJoin(schema.tags, eq(schema.booksTagsLink.tagId, schema.tags.id))
			.where(eq(schema.booksTagsLink.bookId, bookId));

		const publisherRow = book.publisherId
			? (yield* database
					.select({ id: schema.publishers.id, name: schema.publishers.name })
					.from(schema.publishers)
					.where(eq(schema.publishers.id, book.publisherId))
					.limit(1))[0]
			: undefined;
		const identifierRows = yield* database
			.select({
				id: schema.identifiers.id,
				type: schema.identifiers.type,
				value: schema.identifiers.value,
			})
			.from(schema.identifiers)
			.where(eq(schema.identifiers.bookId, bookId));

		const seriesRow = book.seriesId
			? (yield* database
					.select({ id: schema.series.id, name: schema.series.name })
					.from(schema.series)
					.where(eq(schema.series.id, book.seriesId))
					.limit(1))[0]
			: undefined;
		const commentRows = yield* database
			.select({ id: schema.comments.id, text: schema.comments.text })
			.from(schema.comments)
			.where(eq(schema.comments.bookId, bookId));

		return {
			...book,
			files,
			tags: tagRows,
			publisher: publisherRow,
			identifiers: identifierRows,
			series: seriesRow,
			comments: commentRows,
		};
	});

// ---------------------------------------------------------------------------
// Find-or-create helpers (each requires DatabaseContext)
// ---------------------------------------------------------------------------

const findOrCreateTag = (name: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const existing = yield* database
			.select({ id: schema.tags.id })
			.from(schema.tags)
			.where(eq(schema.tags.name, name))
			.limit(1);
		if (existing[0]) return existing[0].id;
		const id = crypto.randomUUID();
		yield* database.insert(schema.tags).values({ id, name });
		return id;
	});

const findOrCreatePublisher = (name: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const existing = yield* database
			.select({ id: schema.publishers.id })
			.from(schema.publishers)
			.where(eq(schema.publishers.name, name))
			.limit(1);
		if (existing[0]) return existing[0].id;
		const id = crypto.randomUUID();
		yield* database.insert(schema.publishers).values({ id, name });
		return id;
	});

const findOrCreateSeries = (name: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const existing = yield* database
			.select({ id: schema.series.id })
			.from(schema.series)
			.where(eq(schema.series.name, name))
			.limit(1);
		if (existing[0]) return existing[0].id;
		const id = crypto.randomUUID();
		yield* database.insert(schema.series).values({ id, name });
		return id;
	});

export const createBookFromUpload = (input: CreateBookFromUploadInput) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const now = new Date();
		const bookId = crypto.randomUUID();
		const fileId = crypto.randomUUID();
		const uuid = crypto.randomUUID();
		const format = input.fileName.split(".").pop()?.toLowerCase() || "epub";
		const r2Key = r2Keys.bookFile({ bookId, fileName: input.fileName });
		const authorsStr = input.authors.join(", ") || "Unknown";

		// TODO: database.batch()
		// Publisher & Series: find-or-create first
		const publisherId = input.publisher?.trim()
			? yield* findOrCreatePublisher(input.publisher.trim())
			: null;
		const seriesId = input.series?.trim()
			? yield* findOrCreateSeries(input.series.trim())
			: null;

		yield* database.insert(schema.books).values({
			id: bookId,
			uuid,
			title: input.title,
			authors: authorsStr,
			timestamp: now,
			lastModified: now,
			pubdate: input.pubdate,
			seriesId,
			seriesIndex: input.seriesIndex,
			language: input.language?.trim() || null,
			publisherId,
			hasCover: input.hasCover ?? false,
		});

		// Tags: find-or-create each, then link
		if (input.tags && input.tags.length > 0) {
			const tagIds = yield* Effect.forEach(
				input.tags,
				(name) => findOrCreateTag(name),
				{ concurrency: 1 },
			);
			for (const tagId of tagIds) {
				yield* database.insert(schema.booksTagsLink).values({ bookId, tagId });
			}
		}

		// Identifiers
		if (input.identifiers && input.identifiers.length > 0) {
			for (const ident of input.identifiers) {
				yield* database.insert(schema.identifiers).values({
					id: crypto.randomUUID(),
					bookId,
					type: ident.type,
					value: ident.value,
				});
			}
		}

		// Description → comments table
		if (input.description?.trim()) {
			yield* database.insert(schema.comments).values({
				id: crypto.randomUUID(),
				bookId,
				text: input.description.trim(),
			});
		}

		yield* database.insert(schema.bookFiles).values({
			id: fileId,
			bookId,
			format,
			fileName: input.fileName,
			r2Key,
			mimeType: input.mimeType,
			size: input.size,
		});

		return {
			book: {
				id: bookId,
				title: input.title,
			},
			file: {
				id: fileId,
				r2Key,
			},
		};
	});

// ---------------------------------------------------------------------------
// updateBook
// ---------------------------------------------------------------------------

export interface UpdateBookInput {
	bookId: string;
	title: string;
	/** Multiple authors, comma-separated in the UI. TODO: individual author pages */
	authors: string[];
	description?: string;
	publisher?: string;
	tags?: string[];
	language?: string;
	/** ISO date string (YYYY-MM-DD) or undefined/null to clear */
	pubdate?: string | null;
	series?: string;
	seriesIndex?: number;
	identifiers?: { type: string; value: string }[];
	// TODO: rating (1–10, displayed as 0–5 stars) — requires ratings table link management
}

export const updateBook = (input: UpdateBookInput) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const now = new Date();
		const { bookId } = input;
		const authorsStr = input.authors.join(", ");

		// Publisher & Series: find-or-create first
		const publisherId = input.publisher?.trim()
			? yield* findOrCreatePublisher(input.publisher.trim())
			: null;
		const seriesId = input.series?.trim()
			? yield* findOrCreateSeries(input.series.trim())
			: null;

		yield* database
			.update(schema.books)
			.set({
				title: input.title,
				authors: authorsStr || null,
				pubdate: input.pubdate ? new Date(input.pubdate) : null,
				seriesId,
				seriesIndex: input.seriesIndex ?? null,
				language: input.language?.trim() || null,
				publisherId,
				lastModified: now,
			})
			.where(eq(schema.books.id, bookId));

		// Tags: replace all links
		yield* database
			.delete(schema.booksTagsLink)
			.where(eq(schema.booksTagsLink.bookId, bookId));
		if (input.tags && input.tags.length > 0) {
			const tagIds = yield* Effect.forEach(
				input.tags,
				(name) => findOrCreateTag(name),
				{ concurrency: 1 },
			);
			for (const tagId of tagIds) {
				yield* database.insert(schema.booksTagsLink).values({ bookId, tagId });
			}
		}

		// Identifiers: replace all
		yield* database
			.delete(schema.identifiers)
			.where(eq(schema.identifiers.bookId, bookId));
		if (input.identifiers && input.identifiers.length > 0) {
			for (const ident of input.identifiers) {
				yield* database.insert(schema.identifiers).values({
					id: crypto.randomUUID(),
					bookId,
					type: ident.type,
					value: ident.value,
				});
			}
		}

		// Comments (description): replace
		yield* database
			.delete(schema.comments)
			.where(eq(schema.comments.bookId, bookId));
		if (input.description?.trim()) {
			yield* database.insert(schema.comments).values({
				id: crypto.randomUUID(),
				bookId,
				text: input.description.trim(),
			});
		}
	});

// ---------------------------------------------------------------------------
// deleteBook - Used for rollback cleanup during upload failures
// ---------------------------------------------------------------------------

export const deleteBook = (bookId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

		// Due to cascade deletes in schema, deleting the book will clean up:
		// - bookFiles records
		// - booksTagsLink records
		// - identifiers
		// - comments
		yield* database.delete(schema.books).where(eq(schema.books.id, bookId));
	});
