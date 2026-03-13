import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" })
		.default(false)
		.notNull(),
	image: text("image"),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => /* @__PURE__ */ new Date())
		.notNull(),
});

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", {
			mode: "timestamp_ms",
		}),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", {
			mode: "timestamp_ms",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const books = sqliteTable(
	"books",
	{
		id: text("id").primaryKey(),
		uuid: text("uuid").notNull().unique(),
		title: text("title").notNull(),
		sort: text("sort"),
		authorSort: text("author_sort"),
		timestamp: integer("timestamp", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		pubdate: integer("pubdate", { mode: "timestamp_ms" }),
		seriesIndex: real("series_index"),
		hasCover: integer("has_cover", { mode: "boolean" })
			.default(false)
			.notNull(),
		lastModified: integer("last_modified", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("books_title_idx").on(table.title)],
);

export const authors = sqliteTable(
	"authors",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		sort: text("sort"),
	},
	(table) => [index("authors_name_idx").on(table.name)],
);

export const booksAuthorsLink = sqliteTable(
	"books_authors_link",
	{
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => authors.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.bookId, table.authorId] }),
		index("books_authors_book_idx").on(table.bookId),
		index("books_authors_author_idx").on(table.authorId),
	],
);

export const tags = sqliteTable(
	"tags",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull().unique(),
	},
	(table) => [index("tags_name_idx").on(table.name)],
);

export const booksTagsLink = sqliteTable(
	"books_tags_link",
	{
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.bookId, table.tagId] }),
		index("books_tags_book_idx").on(table.bookId),
		index("books_tags_tag_idx").on(table.tagId),
	],
);

export const series = sqliteTable(
	"series",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		sort: text("sort"),
	},
	(table) => [index("series_name_idx").on(table.name)],
);

export const booksSeriesLink = sqliteTable(
	"books_series_link",
	{
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		seriesId: text("series_id")
			.notNull()
			.references(() => series.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.bookId, table.seriesId] }),
		index("books_series_book_idx").on(table.bookId),
		index("books_series_series_idx").on(table.seriesId),
	],
);

export const ratings = sqliteTable("ratings", {
	id: text("id").primaryKey(),
	rating: integer("rating").notNull(),
});

export const booksRatingsLink = sqliteTable(
	"books_ratings_link",
	{
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		ratingId: text("rating_id")
			.notNull()
			.references(() => ratings.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.bookId, table.ratingId] }),
		index("books_ratings_book_idx").on(table.bookId),
		index("books_ratings_rating_idx").on(table.ratingId),
	],
);

export const languages = sqliteTable(
	"languages",
	{
		id: text("id").primaryKey(),
		langCode: text("lang_code").notNull().unique(),
	},
	(table) => [index("languages_code_idx").on(table.langCode)],
);

export const booksLanguagesLink = sqliteTable(
	"books_languages_link",
	{
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		languageId: text("language_id")
			.notNull()
			.references(() => languages.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.bookId, table.languageId] }),
		index("books_languages_book_idx").on(table.bookId),
		index("books_languages_language_idx").on(table.languageId),
	],
);

export const publishers = sqliteTable(
	"publishers",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		sort: text("sort"),
	},
	(table) => [index("publishers_name_idx").on(table.name)],
);

export const booksPublishersLink = sqliteTable(
	"books_publishers_link",
	{
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		publisherId: text("publisher_id")
			.notNull()
			.references(() => publishers.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({ columns: [table.bookId, table.publisherId] }),
		index("books_publishers_book_idx").on(table.bookId),
		index("books_publishers_publisher_idx").on(table.publisherId),
	],
);

export const identifiers = sqliteTable(
	"identifiers",
	{
		id: text("id").primaryKey(),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		value: text("value").notNull(),
	},
	(table) => [
		index("identifiers_book_idx").on(table.bookId),
		index("identifiers_type_idx").on(table.type),
	],
);

export const comments = sqliteTable("comments", {
	id: text("id").primaryKey(),
	bookId: text("book_id")
		.notNull()
		.references(() => books.id, { onDelete: "cascade" }),
	text: text("text").notNull(),
});

export const bookFiles = sqliteTable(
	"book_files",
	{
		id: text("id").primaryKey(),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		format: text("format").notNull(),
		fileName: text("file_name").notNull(),
		r2Key: text("r2_key").notNull().unique(),
		mimeType: text("mime_type"),
		size: integer("size").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		index("book_files_book_idx").on(table.bookId),
		index("book_files_format_idx").on(table.format),
	],
);

export const booksRelations = relations(books, ({ many }) => ({
	authors: many(booksAuthorsLink),
	tags: many(booksTagsLink),
	series: many(booksSeriesLink),
	ratings: many(booksRatingsLink),
	languages: many(booksLanguagesLink),
	publishers: many(booksPublishersLink),
	identifiers: many(identifiers),
	comments: many(comments),
	files: many(bookFiles),
	conversionJobs: many(conversionJobs),
}));

export const authorsRelations = relations(authors, ({ many }) => ({
	books: many(booksAuthorsLink),
}));

export const booksAuthorsLinkRelations = relations(
	booksAuthorsLink,
	({ one }) => ({
		book: one(books, {
			fields: [booksAuthorsLink.bookId],
			references: [books.id],
		}),
		author: one(authors, {
			fields: [booksAuthorsLink.authorId],
			references: [authors.id],
		}),
	}),
);

export const tagsRelations = relations(tags, ({ many }) => ({
	books: many(booksTagsLink),
}));

export const booksTagsLinkRelations = relations(booksTagsLink, ({ one }) => ({
	book: one(books, {
		fields: [booksTagsLink.bookId],
		references: [books.id],
	}),
	tag: one(tags, {
		fields: [booksTagsLink.tagId],
		references: [tags.id],
	}),
}));

export const seriesRelations = relations(series, ({ many }) => ({
	books: many(booksSeriesLink),
}));

export const booksSeriesLinkRelations = relations(
	booksSeriesLink,
	({ one }) => ({
		book: one(books, {
			fields: [booksSeriesLink.bookId],
			references: [books.id],
		}),
		series: one(series, {
			fields: [booksSeriesLink.seriesId],
			references: [series.id],
		}),
	}),
);

export const ratingsRelations = relations(ratings, ({ many }) => ({
	books: many(booksRatingsLink),
}));

export const booksRatingsLinkRelations = relations(
	booksRatingsLink,
	({ one }) => ({
		book: one(books, {
			fields: [booksRatingsLink.bookId],
			references: [books.id],
		}),
		rating: one(ratings, {
			fields: [booksRatingsLink.ratingId],
			references: [ratings.id],
		}),
	}),
);

export const languagesRelations = relations(languages, ({ many }) => ({
	books: many(booksLanguagesLink),
}));

export const booksLanguagesLinkRelations = relations(
	booksLanguagesLink,
	({ one }) => ({
		book: one(books, {
			fields: [booksLanguagesLink.bookId],
			references: [books.id],
		}),
		language: one(languages, {
			fields: [booksLanguagesLink.languageId],
			references: [languages.id],
		}),
	}),
);

export const publishersRelations = relations(publishers, ({ many }) => ({
	books: many(booksPublishersLink),
}));

export const booksPublishersLinkRelations = relations(
	booksPublishersLink,
	({ one }) => ({
		book: one(books, {
			fields: [booksPublishersLink.bookId],
			references: [books.id],
		}),
		publisher: one(publishers, {
			fields: [booksPublishersLink.publisherId],
			references: [publishers.id],
		}),
	}),
);

export const identifiersRelations = relations(identifiers, ({ one }) => ({
	book: one(books, {
		fields: [identifiers.bookId],
		references: [books.id],
	}),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
	book: one(books, {
		fields: [comments.bookId],
		references: [books.id],
	}),
}));

export const bookFilesRelations = relations(bookFiles, ({ one }) => ({
	book: one(books, {
		fields: [bookFiles.bookId],
		references: [books.id],
	}),
}));

export type ConversionJobStatus = "pending" | "processing" | "done" | "failed";

export const conversionJobs = sqliteTable(
	"conversion_jobs",
	{
		id: text("id").primaryKey(),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		sourceFileId: text("source_file_id")
			.notNull()
			.references(() => bookFiles.id, { onDelete: "cascade" }),
		targetFormat: text("target_format").notNull(),
		status: text("status")
			.$type<ConversionJobStatus>()
			.notNull()
			.default("pending"),
		resultFileId: text("result_file_id").references(() => bookFiles.id, {
			onDelete: "set null",
		}),
		errorMessage: text("error_message"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("conversion_jobs_book_idx").on(table.bookId),
		index("conversion_jobs_status_idx").on(table.status),
	],
);

export const conversionJobsRelations = relations(conversionJobs, ({ one }) => ({
	book: one(books, {
		fields: [conversionJobs.bookId],
		references: [books.id],
	}),
	sourceFile: one(bookFiles, {
		fields: [conversionJobs.sourceFileId],
		references: [bookFiles.id],
		relationName: "sourceFile",
	}),
	resultFile: one(bookFiles, {
		fields: [conversionJobs.resultFileId],
		references: [bookFiles.id],
		relationName: "resultFile",
	}),
}));
