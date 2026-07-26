import "@tanstack/react-start/server-only";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import * as schema from "#/shared/db/schema";
import { DatabaseContext, DatabaseLive } from "#/shared/layers/DatabaseLayer";
import { r2Keys } from "#/shared/lib/r2-keys";

class BookNotFound extends Data.TaggedError("BookNotFound")<{
	readonly bookId: string;
}> {}

interface BookMetadataForProcess {
	title: string;
	authors: string[];
	language?: string;
	publisher?: string;
	hasCover: boolean;
}

interface MetadataSyncFile {
	fileId: string;
	bookId: string;
	r2Key: string;
	format: schema.BookFileFormat;
}

class MetadataJobNotFound extends Data.TaggedError("MetadataJobNotFound")<{
	readonly jobId: string;
}> {}

const toBookFileFormat = (value?: string): schema.BookFileFormat => {
	switch ((value ?? "").toLowerCase()) {
		case "epub":
		case "kepub":
		case "azw3":
		case "mobi":
			return value as schema.BookFileFormat;
		default:
			return "epub";
	}
};

interface ListBooksInput {
	page?: number;
	limit?: number;
	author?: string;
}

interface ListBooksResult {
	items: Array<typeof schema.books.$inferSelect>;
	total: number;
	page: number;
	limit: number;
}

interface CreateBookFromUploadInput {
	title: string;
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

export interface UpdateBookInput {
	bookId: string;
	title: string;
	authors: string[];
	description?: string;
	publisher?: string;
	tags?: string[];
	language?: string;
	hasCover?: boolean;
	/** ISO date string (YYYY-MM-DD) or undefined/null to clear */
	pubdate?: string | null;
	series?: string;
	seriesIndex?: number;
	identifiers?: { type: string; value: string }[];
	// TODO: rating (1–10, displayed as 0–5 stars) — requires ratings table link management
}

export class BookService extends Effect.Service<BookService>()("BookService", {
	accessors: true,
	dependencies: [DatabaseLive],
	effect: Effect.gen(function* () {
		const database = yield* DatabaseContext;

		const listBooks = Effect.fn("BookService.listBooks")(function* ({
			page = 1,
			limit = 20,
			author,
		}: ListBooksInput = {}) {
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

		const getBookById = Effect.fn("BookService.getBookById")(function* (
			bookId: string,
		) {
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

		const getBookMetadataForProcess = Effect.fn(
			"BookService.getBookMetadataForProcess",
		)(function* (bookId: string) {
			const rows = yield* database
				.select({
					id: schema.books.id,
					title: schema.books.title,
					authors: schema.books.authors,
					language: schema.books.language,
					hasCover: schema.books.hasCover,
					publisher: schema.publishers.name,
				})
				.from(schema.books)
				.leftJoin(
					schema.publishers,
					eq(schema.publishers.id, schema.books.publisherId),
				)
				.where(eq(schema.books.id, bookId))
				.limit(1);

			const row = rows[0];
			if (!row) {
				return yield* Effect.fail(new BookNotFound({ bookId }));
			}

			return {
				title: row.title,
				authors: (row.authors ?? "")
					.split(",")
					.map((value) => value.trim())
					.filter(Boolean),
				language: row.language ?? undefined,
				publisher: row.publisher ?? undefined,
				hasCover: row.hasCover,
			} satisfies BookMetadataForProcess;
		});

		const listBookFilesForMetadataSync = Effect.fn(
			"BookService.listBookFilesForMetadataSync",
		)(function* (bookId: string) {
			const files = yield* database
				.select({
					fileId: schema.bookFiles.id,
					bookId: schema.bookFiles.bookId,
					r2Key: schema.bookFiles.r2Key,
					format: schema.bookFiles.format,
				})
				.from(schema.bookFiles)
				.where(eq(schema.bookFiles.bookId, bookId));

			return files satisfies MetadataSyncFile[];
		});

		const setBookFilesMetadataStatus = Effect.fn(
			"BookService.setBookFilesMetadataStatus",
		)(function* ({
			bookId,
			fileIds,
			status,
			onlyIfCurrentStatusIn,
		}: {
			bookId: string;
			fileIds?: string[];
			status: schema.MetadataSyncStatus;
			onlyIfCurrentStatusIn?: schema.MetadataSyncStatus[];
		}) {
			if (fileIds && fileIds.length === 0) {
				return;
			}

			const baseWhereClause = fileIds
				? and(
						eq(schema.bookFiles.bookId, bookId),
						inArray(schema.bookFiles.id, fileIds),
					)
				: eq(schema.bookFiles.bookId, bookId);
			const whereClause =
				onlyIfCurrentStatusIn && onlyIfCurrentStatusIn.length > 0
					? and(
							baseWhereClause,
							inArray(schema.bookFiles.metadataStatus, onlyIfCurrentStatusIn),
						)
					: baseWhereClause;

			yield* database
				.update(schema.bookFiles)
				.set({ metadataStatus: status })
				.where(whereClause);
		});

		const setBookFileMetadataStatus = Effect.fn(
			"BookService.setBookFileMetadataStatus",
		)(function* ({
			bookId,
			fileId,
			status,
			onlyIfCurrentStatusIn,
		}: {
			bookId: string;
			fileId: string;
			status: schema.MetadataSyncStatus;
			onlyIfCurrentStatusIn?: schema.MetadataSyncStatus[];
		}) {
			const baseWhere = and(
				eq(schema.bookFiles.bookId, bookId),
				eq(schema.bookFiles.id, fileId),
			);
			const whereClause =
				onlyIfCurrentStatusIn && onlyIfCurrentStatusIn.length > 0
					? and(
							baseWhere,
							inArray(schema.bookFiles.metadataStatus, onlyIfCurrentStatusIn),
						)
					: baseWhere;

			yield* database
				.update(schema.bookFiles)
				.set({ metadataStatus: status })
				.where(whereClause);
		});

		const createMetadataJob = Effect.fn("BookService.createMetadataJob")(
			function* ({ bookId, userId }: { bookId: string; userId: string }) {
				const id = crypto.randomUUID();

				yield* database.insert(schema.metadataJobs).values({
					id,
					bookId,
					userId,
				});

				return { jobId: id };
			},
		);

		const getMetadataJob = Effect.fn("BookService.getMetadataJob")(function* (
			jobId: string,
		) {
			const rows = yield* database
				.select()
				.from(schema.metadataJobs)
				.where(eq(schema.metadataJobs.id, jobId))
				.limit(1);

			const job = rows[0];
			if (!job) {
				return yield* Effect.fail(new MetadataJobNotFound({ jobId }));
			}

			return job;
		});

		const updateMetadataJobStatus = Effect.fn(
			"BookService.updateMetadataJobStatus",
		)(function* (
			jobId: string,
			update: {
				status: schema.MetadataJobStatus;
				errorMessage?: string;
			},
		) {
			yield* database
				.update(schema.metadataJobs)
				.set({
					status: update.status,
					errorMessage: update.errorMessage ?? null,
				})
				.where(eq(schema.metadataJobs.id, jobId));
		});

		const failStaleMetadataTasks = Effect.fn(
			"BookService.failStaleMetadataTasks",
		)(function* ({
			staleBefore,
			errorMessage,
		}: {
			staleBefore: Date;
			errorMessage: string;
		}) {
			const staleJobs = yield* database
				.select({
					id: schema.metadataJobs.id,
					bookId: schema.metadataJobs.bookId,
				})
				.from(schema.metadataJobs)
				.where(
					and(
						inArray(schema.metadataJobs.status, ["pending", "processing"]),
						lt(schema.metadataJobs.updatedAt, staleBefore),
					),
				);

			if (staleJobs.length === 0) {
				return { affectedCount: 0 };
			}

			const staleJobIds = staleJobs.map((job) => job.id);
			const staleBookIds = [...new Set(staleJobs.map((job) => job.bookId))];

			yield* database
				.update(schema.metadataJobs)
				.set({
					status: "failed",
					errorMessage,
					updatedAt: new Date(),
				})
				.where(inArray(schema.metadataJobs.id, staleJobIds));

			if (staleBookIds.length > 0) {
				const hasActiveJobs = yield* database
					.select({ bookId: schema.metadataJobs.bookId })
					.from(schema.metadataJobs)
					.where(
						and(
							inArray(schema.metadataJobs.bookId, staleBookIds),
							inArray(schema.metadataJobs.status, ["pending", "processing"]),
						),
					);

				const activeBookIdSet = new Set(hasActiveJobs.map((row) => row.bookId));
				const staleOnlyBookIds = staleBookIds.filter(
					(bookId) => !activeBookIdSet.has(bookId),
				);

				if (staleOnlyBookIds.length > 0) {
					yield* database
						.update(schema.bookFiles)
						.set({ metadataStatus: "failed" })
						.where(
							and(
								inArray(schema.bookFiles.bookId, staleOnlyBookIds),
								inArray(schema.bookFiles.metadataStatus, [
									"pending",
									"processing",
								]),
							),
						);
				}
			}

			return { affectedCount: staleJobIds.length };
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

		const createBookFromUpload = Effect.fn("BookService.createBookFromUpload")(
			function* (input: CreateBookFromUploadInput) {
				const now = new Date();
				const bookId = crypto.randomUUID();
				const fileId = crypto.randomUUID();
				const uuid = crypto.randomUUID();
				const format = toBookFileFormat(input.fileName.split(".").pop());
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
						yield* database
							.insert(schema.booksTagsLink)
							.values({ bookId, tagId });
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
			},
		);

		// ---------------------------------------------------------------------------
		// updateBook
		// ---------------------------------------------------------------------------

		const updateBook = Effect.fn("BookService.updateBook")(function* (
			input: UpdateBookInput,
		) {
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
					...(typeof input.hasCover === "boolean"
						? { hasCover: input.hasCover }
						: {}),
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
					yield* database
						.insert(schema.booksTagsLink)
						.values({ bookId, tagId });
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

		const deleteBook = Effect.fn("BookService.deleteBook")(function* (
			bookId: string,
		) {
			// Due to cascade deletes in schema, deleting the book will clean up:
			// - bookFiles records
			// - booksTagsLink records
			// - identifiers
			// - comments
			yield* database.delete(schema.books).where(eq(schema.books.id, bookId));
		});

		return {
			listBooks,
			getBookById,
			getBookMetadataForProcess,
			listBookFilesForMetadataSync,
			setBookFilesMetadataStatus,
			setBookFileMetadataStatus,
			createMetadataJob,
			getMetadataJob,
			updateMetadataJobStatus,
			failStaleMetadataTasks,
			createBookFromUpload,
			updateBook,
			deleteBook,
		};
	}),
}) {}
