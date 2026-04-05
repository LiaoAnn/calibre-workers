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
	role: text("role", { enum: ["admin", "user"] })
		.default("user")
		.notNull(),
	status: text("status", { enum: ["pending", "active"] })
		.default("pending")
		.notNull(),
	deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
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
		/** Comma-separated list of authors (e.g., "Author A, Author B") */
		authors: text("authors"),
		timestamp: integer("timestamp", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		pubdate: integer("pubdate", { mode: "timestamp_ms" }),
		seriesId: text("series_id").references(() => series.id, {
			onDelete: "set null",
		}),
		seriesIndex: real("series_index"),
		language: text("language"),
		publisherId: text("publisher_id").references(() => publishers.id, {
			onDelete: "set null",
		}),
		rating: integer("rating"),
		hasCover: integer("has_cover", { mode: "boolean" })
			.default(false)
			.notNull(),
		lastModified: integer("last_modified", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("books_title_idx").on(table.title),
		index("books_series_idx").on(table.seriesId),
		index("books_publisher_idx").on(table.publisherId),
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

// TODO(shelves): implement end-to-end visibility behavior in service/API/UI.
export type ShelfVisibility = "private" | "public" | "shared";
export type ShelfMemberRole = "owner" | "editor" | "viewer";

export const shelves = sqliteTable(
	"shelves",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		visibility: text("visibility")
			.$type<ShelfVisibility>()
			.notNull()
			.default("private"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("shelves_visibility_idx").on(table.visibility)],
);

export const shelfBooks = sqliteTable(
	"shelf_books",
	{
		shelfId: text("shelf_id")
			.notNull()
			.references(() => shelves.id, { onDelete: "cascade" }),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		order: integer("display_order").notNull().default(0),
		addedAt: integer("added_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.shelfId, table.bookId] }),
		index("shelf_books_shelf_idx").on(table.shelfId),
		index("shelf_books_book_idx").on(table.bookId),
		index("shelf_books_order_idx").on(table.shelfId, table.order),
	],
);

export const shelfMembers = sqliteTable(
	"shelf_members",
	{
		// TODO(shelves): implement invite/share member flows and role management UI/API.
		shelfId: text("shelf_id")
			.notNull()
			.references(() => shelves.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").$type<ShelfMemberRole>().notNull().default("viewer"),
		addedByUserId: text("added_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.shelfId, table.userId] }),
		index("shelf_members_shelf_idx").on(table.shelfId),
		index("shelf_members_user_idx").on(table.userId),
		index("shelf_members_role_idx").on(table.role),
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

export const publishers = sqliteTable(
	"publishers",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		sort: text("sort"),
	},
	(table) => [index("publishers_name_idx").on(table.name)],
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

// Keep known formats explicit for autocomplete while still allowing custom formats.
export type BookFileFormat = "epub" | "kepub" | "azw3" | "mobi";
export type MetadataSyncStatus = "ready" | "pending" | "processing" | "failed";

export const bookFiles = sqliteTable(
	"book_files",
	{
		id: text("id").primaryKey(),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		format: text("format").$type<BookFileFormat>().notNull(),
		metadataStatus: text("metadata_status")
			.$type<MetadataSyncStatus>()
			.notNull()
			.default("ready"),
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
		index("book_files_metadata_status_idx").on(table.metadataStatus),
	],
);

export const booksRelations = relations(books, ({ one, many }) => ({
	tags: many(booksTagsLink),
	shelfLinks: many(shelfBooks),
	series: one(series, { fields: [books.seriesId], references: [series.id] }),
	publisher: one(publishers, {
		fields: [books.publisherId],
		references: [publishers.id],
	}),
	identifiers: many(identifiers),
	comments: many(comments),
	files: many(bookFiles),
	conversionJobs: many(conversionJobs),
	metadataJobs: many(metadataJobs),
}));

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

export const shelvesRelations = relations(shelves, ({ many }) => ({
	bookLinks: many(shelfBooks),
	members: many(shelfMembers),
}));

export const shelfBooksRelations = relations(shelfBooks, ({ one }) => ({
	shelf: one(shelves, {
		fields: [shelfBooks.shelfId],
		references: [shelves.id],
	}),
	book: one(books, {
		fields: [shelfBooks.bookId],
		references: [books.id],
	}),
}));

export const shelfMembersRelations = relations(shelfMembers, ({ one }) => ({
	shelf: one(shelves, {
		fields: [shelfMembers.shelfId],
		references: [shelves.id],
	}),
	member: one(user, {
		fields: [shelfMembers.userId],
		references: [user.id],
		relationName: "shelfMemberUser",
	}),
	addedBy: one(user, {
		fields: [shelfMembers.addedByUserId],
		references: [user.id],
		relationName: "shelfMemberAddedByUser",
	}),
}));

export const seriesRelations = relations(series, ({ many }) => ({
	books: many(books),
}));

export const publishersRelations = relations(publishers, ({ many }) => ({
	books: many(books),
}));

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

export type MetadataJobStatus = "pending" | "processing" | "done" | "failed";

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
		// for notification center
		readAt: integer("read_at", { mode: "timestamp_ms" }),
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

export const metadataJobs = sqliteTable(
	"metadata_jobs",
	{
		id: text("id").primaryKey(),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		status: text("status")
			.$type<MetadataJobStatus>()
			.notNull()
			.default("pending"),
		errorMessage: text("error_message"),
		readAt: integer("read_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("metadata_jobs_book_idx").on(table.bookId),
		index("metadata_jobs_user_idx").on(table.userId),
		index("metadata_jobs_status_idx").on(table.status),
		index("metadata_jobs_updated_idx").on(table.updatedAt),
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

export const metadataJobsRelations = relations(metadataJobs, ({ one }) => ({
	book: one(books, {
		fields: [metadataJobs.bookId],
		references: [books.id],
	}),
	user: one(user, {
		fields: [metadataJobs.userId],
		references: [user.id],
	}),
}));

// Upload Tasks - Track file upload status for notification center
type UploadTaskStatus = "pending" | "processing" | "success" | "failed";

export const uploadTasks = sqliteTable(
	"upload_tasks",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		// for identifying the file that upload failed
		fileName: text("file_name").notNull(),
		// multipart session state for large upload lifecycle control
		stagingR2Key: text("staging_r2_key"),
		multipartUploadId: text("multipart_upload_id"),
		status: text("status")
			.$type<UploadTaskStatus>()
			.notNull()
			.default("pending"),
		bookId: text("book_id").references(() => books.id, {
			onDelete: "set null",
		}),
		errorMessage: text("error_message"),
		readAt: integer("read_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("upload_tasks_user_idx").on(table.userId),
		index("upload_tasks_status_idx").on(table.status),
		index("upload_tasks_created_idx").on(table.createdAt),
	],
);

export const uploadTasksRelations = relations(uploadTasks, ({ one }) => ({
	user: one(user, {
		fields: [uploadTasks.userId],
		references: [user.id],
	}),
	book: one(books, {
		fields: [uploadTasks.bookId],
		references: [books.id],
	}),
}));
