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
}

export interface ListBooksResult {
	items: Array<typeof schema.books.$inferSelect>;
	total: number;
	page: number;
	limit: number;
}

export interface CreateBookFromUploadInput {
	title: string;
	author: string;
	fileName: string;
	mimeType?: string;
	size: number;
	hasCover?: boolean;
}

export const listBooks = ({ page = 1, limit = 20 }: ListBooksInput = {}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const safePage = Math.max(1, page);
		const safeLimit = Math.max(1, Math.min(100, limit));
		const offset = (safePage - 1) * safeLimit;

		const items = yield* database
			.select()
			.from(schema.books)
			.orderBy(desc(schema.books.timestamp))
			.limit(safeLimit)
			.offset(offset);

		const countRows = yield* database
			.select({ count: sql<number>`count(*)` })
			.from(schema.books);

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

		const authorRows = yield* database
			.select({
				id: schema.authors.id,
				name: schema.authors.name,
				sort: schema.authors.sort,
			})
			.from(schema.booksAuthorsLink)
			.innerJoin(
				schema.authors,
				eq(schema.booksAuthorsLink.authorId, schema.authors.id),
			)
			.where(eq(schema.booksAuthorsLink.bookId, bookId));

		const tagRows = yield* database
			.select({ id: schema.tags.id, name: schema.tags.name })
			.from(schema.booksTagsLink)
			.innerJoin(schema.tags, eq(schema.booksTagsLink.tagId, schema.tags.id))
			.where(eq(schema.booksTagsLink.bookId, bookId));

		const publisherRows = yield* database
			.select({
				id: schema.publishers.id,
				name: schema.publishers.name,
			})
			.from(schema.booksPublishersLink)
			.innerJoin(
				schema.publishers,
				eq(schema.booksPublishersLink.publisherId, schema.publishers.id),
			)
			.where(eq(schema.booksPublishersLink.bookId, bookId));

		const identifierRows = yield* database
			.select({
				id: schema.identifiers.id,
				type: schema.identifiers.type,
				value: schema.identifiers.value,
			})
			.from(schema.identifiers)
			.where(eq(schema.identifiers.bookId, bookId));

		return {
			...book,
			files,
			authors: authorRows.map((a) => ({ bookId, authorId: a.id, author: a })),
			tags: tagRows,
			publishers: publisherRows,
			identifiers: identifierRows,
		};
	});

export const createBookFromUpload = (input: CreateBookFromUploadInput) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const now = new Date();
		const bookId = crypto.randomUUID();
		const authorId = crypto.randomUUID();
		const fileId = crypto.randomUUID();
		const uuid = crypto.randomUUID();
		const format = input.fileName.split(".").pop()?.toLowerCase() || "epub";
		const r2Key = r2Keys.bookFile({ bookId, fileName: input.fileName });

		// TODO: database.batch()
		yield* database.insert(schema.books).values({
			id: bookId,
			uuid,
			title: input.title,
			authorSort: input.author,
			timestamp: now,
			lastModified: now,
			hasCover: input.hasCover ?? false,
		});

		yield* database.insert(schema.authors).values({
			id: authorId,
			name: input.author,
			sort: input.author,
		});

		yield* database.insert(schema.booksAuthorsLink).values({
			bookId,
			authorId,
		});

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
