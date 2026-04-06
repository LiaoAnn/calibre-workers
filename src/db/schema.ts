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
	koboAuthTokens: many(koboAuthTokens),
	archivedBooks: many(archivedBooks),
	koboSyncedBooks: many(koboSyncedBooks),
	koboReadingStates: many(koboReadingStates),
	shelfArchiveEntries: many(shelfArchive),
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
export type KoboReadStatus = "ReadyToRead" | "Reading" | "Finished";

export type KoboLoggedBody =
	| { type: "empty" }
	| { type: "json"; value: unknown; truncated?: boolean }
	| { type: "form"; value: Record<string, unknown>; truncated?: boolean }
	| {
			type: "text";
			contentType: string;
			value: string;
			truncated?: boolean;
	  }
	| {
			type: "binary";
			contentType: string;
			encoding: "base64";
			value: string;
			truncated?: boolean;
	  };

// TODO: use deleted_at and remove shelfArchive after implementing proper sync and tombstone handling.
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
		enableKoboSync: integer("enable_kobo_sync", { mode: "boolean" })
			.default(false)
			.notNull(),
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
		index("shelf_members_enable_kobo_sync_idx").on(
			table.userId,
			table.enableKoboSync,
		),
	],
);

// Deletion tombstone used for sync: after a shelf disappears, device still
// needs a "DeletedTag" event, so we keep a per-user record temporarily.
export const shelfArchive = sqliteTable(
	"shelf_archive",
	{
		id: text("id").primaryKey(),
		shelfId: text("shelf_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		lastModified: integer("last_modified", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("shelf_archive_user_idx").on(table.userId),
		index("shelf_archive_shelf_idx").on(table.shelfId),
		index("shelf_archive_last_modified_idx").on(table.lastModified),
	],
);

export const koboAuthTokens = sqliteTable(
	"kobo_auth_tokens",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("kobo_auth_tokens_user_idx").on(table.userId),
		index("kobo_auth_tokens_revoked_idx").on(table.revokedAt),
	],
);

export const koboSyncedBooks = sqliteTable(
	"kobo_synced_books",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("kobo_synced_books_user_idx").on(table.userId),
		index("kobo_synced_books_book_idx").on(table.bookId),
		index("kobo_synced_books_user_book_idx").on(table.userId, table.bookId),
		index("kobo_synced_books_created_idx").on(table.createdAt),
	],
);

// Archive status is device/user specific. We keep it separate from books to
// avoid mutating global metadata for all users.
export const archivedBooks = sqliteTable(
	"archived_books",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		isArchived: integer("is_archived", { mode: "boolean" })
			.default(true)
			.notNull(),
		lastModified: integer("last_modified", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("archived_books_user_idx").on(table.userId),
		index("archived_books_book_idx").on(table.bookId),
		index("archived_books_user_book_idx").on(table.userId, table.bookId),
		index("archived_books_last_modified_idx").on(table.lastModified),
	],
);

// Kobo uses a state-level lastModified/priority timestamp that is distinct
// from bookmark/statistics update timestamps.
export const koboReadingStates = sqliteTable(
	"kobo_reading_states",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		bookId: text("book_id")
			.notNull()
			.references(() => books.id, { onDelete: "cascade" }),
		status: text("status")
			.$type<KoboReadStatus>()
			.default("ReadyToRead")
			.notNull(),
		lastTimeStartedReading: integer("last_time_started_reading", {
			mode: "timestamp_ms",
		}),
		timesStartedReading: integer("times_started_reading").default(0).notNull(),
		lastModified: integer("last_modified", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		priorityTimestamp: integer("priority_timestamp", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("kobo_reading_states_user_idx").on(table.userId),
		index("kobo_reading_states_book_idx").on(table.bookId),
		index("kobo_reading_states_user_book_idx").on(table.userId, table.bookId),
		index("kobo_reading_states_last_modified_idx").on(table.lastModified),
	],
);

export const koboBookmarks = sqliteTable(
	"kobo_bookmarks",
	{
		// Separate 1:1 table to keep bookmark-specific timestamp and sparse fields.
		koboReadingStateId: text("kobo_reading_state_id")
			.primaryKey()
			.references(() => koboReadingStates.id, { onDelete: "cascade" }),
		lastModified: integer("last_modified", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		locationSource: text("location_source"),
		locationType: text("location_type"),
		locationValue: text("location_value"),
		progressPercent: real("progress_percent"),
		contentSourceProgressPercent: real("content_source_progress_percent"),
	},
	(table) => [index("kobo_bookmarks_last_modified_idx").on(table.lastModified)],
);

export const koboStatistics = sqliteTable(
	"kobo_statistics",
	{
		// Separate 1:1 table to mirror Kobo's Statistics object lifecycle.
		koboReadingStateId: text("kobo_reading_state_id")
			.primaryKey()
			.references(() => koboReadingStates.id, { onDelete: "cascade" }),
		lastModified: integer("last_modified", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
		remainingTimeMinutes: integer("remaining_time_minutes"),
		spentReadingMinutes: integer("spent_reading_minutes"),
	},
	(table) => [
		index("kobo_statistics_last_modified_idx").on(table.lastModified),
	],
);

export const koboApiLogs = sqliteTable(
	"kobo_api_logs",
	{
		id: text("id").primaryKey(),
		authTokenId: text("auth_token_id").references(() => koboAuthTokens.id, {
			onDelete: "set null",
		}),
		method: text("method").notNull(),
		path: text("path").notNull(),
		query: text("query"),
		isHandledInternally: integer("is_handled_internally", { mode: "boolean" })
			.default(false)
			.notNull(),
		requestHeaders: text("request_headers", { mode: "json" })
			.$type<Record<string, string>>()
			.notNull(),
		requestBody: text("request_body", { mode: "json" })
			.$type<KoboLoggedBody>()
			.notNull(),
		responseStatus: integer("response_status").notNull(),
		responseHeaders: text("response_headers", { mode: "json" })
			.$type<Record<string, string>>()
			.notNull(),
		responseBody: text("response_body", { mode: "json" })
			.$type<KoboLoggedBody>()
			.notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		index("kobo_api_logs_auth_token_idx").on(table.authTokenId),
		index("kobo_api_logs_created_idx").on(table.createdAt),
		index("kobo_api_logs_path_idx").on(table.path),
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
	archivedBooks: many(archivedBooks),
	koboSyncedBooks: many(koboSyncedBooks),
	koboReadingStates: many(koboReadingStates),
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

export const shelfArchiveRelations = relations(shelfArchive, ({ one }) => ({
	user: one(user, {
		fields: [shelfArchive.userId],
		references: [user.id],
	}),
}));

export const koboAuthTokensRelations = relations(
	koboAuthTokens,
	({ one, many }) => ({
		user: one(user, {
			fields: [koboAuthTokens.userId],
			references: [user.id],
		}),
		apiLogs: many(koboApiLogs),
	}),
);

export const koboSyncedBooksRelations = relations(
	koboSyncedBooks,
	({ one }) => ({
		user: one(user, {
			fields: [koboSyncedBooks.userId],
			references: [user.id],
		}),
		book: one(books, {
			fields: [koboSyncedBooks.bookId],
			references: [books.id],
		}),
	}),
);

export const archivedBooksRelations = relations(archivedBooks, ({ one }) => ({
	user: one(user, {
		fields: [archivedBooks.userId],
		references: [user.id],
	}),
	book: one(books, {
		fields: [archivedBooks.bookId],
		references: [books.id],
	}),
}));

export const koboReadingStatesRelations = relations(
	koboReadingStates,
	({ one }) => ({
		user: one(user, {
			fields: [koboReadingStates.userId],
			references: [user.id],
		}),
		book: one(books, {
			fields: [koboReadingStates.bookId],
			references: [books.id],
		}),
		bookmark: one(koboBookmarks, {
			fields: [koboReadingStates.id],
			references: [koboBookmarks.koboReadingStateId],
		}),
		statistics: one(koboStatistics, {
			fields: [koboReadingStates.id],
			references: [koboStatistics.koboReadingStateId],
		}),
	}),
);

export const koboBookmarksRelations = relations(koboBookmarks, ({ one }) => ({
	readingState: one(koboReadingStates, {
		fields: [koboBookmarks.koboReadingStateId],
		references: [koboReadingStates.id],
	}),
}));

export const koboStatisticsRelations = relations(koboStatistics, ({ one }) => ({
	readingState: one(koboReadingStates, {
		fields: [koboStatistics.koboReadingStateId],
		references: [koboReadingStates.id],
	}),
}));

export const koboApiLogsRelations = relations(koboApiLogs, ({ one }) => ({
	authToken: one(koboAuthTokens, {
		fields: [koboApiLogs.authTokenId],
		references: [koboAuthTokens.id],
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
