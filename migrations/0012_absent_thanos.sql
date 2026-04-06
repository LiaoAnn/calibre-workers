CREATE TABLE `archived_books` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`is_archived` integer DEFAULT true NOT NULL,
	`last_modified` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `archived_books_user_idx` ON `archived_books` (`user_id`);--> statement-breakpoint
CREATE INDEX `archived_books_book_idx` ON `archived_books` (`book_id`);--> statement-breakpoint
CREATE INDEX `archived_books_user_book_idx` ON `archived_books` (`user_id`,`book_id`);--> statement-breakpoint
CREATE INDEX `archived_books_last_modified_idx` ON `archived_books` (`last_modified`);--> statement-breakpoint
CREATE TABLE `kobo_api_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_token_id` text,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`query` text,
	`is_handled_internally` integer DEFAULT false NOT NULL,
	`request_headers` text NOT NULL,
	`request_body` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_headers` text NOT NULL,
	`response_body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`auth_token_id`) REFERENCES `kobo_auth_tokens`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `kobo_api_logs_auth_token_idx` ON `kobo_api_logs` (`auth_token_id`);--> statement-breakpoint
CREATE INDEX `kobo_api_logs_created_idx` ON `kobo_api_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `kobo_api_logs_path_idx` ON `kobo_api_logs` (`path`);--> statement-breakpoint
CREATE TABLE `kobo_auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kobo_auth_tokens_token_unique` ON `kobo_auth_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `kobo_auth_tokens_user_idx` ON `kobo_auth_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `kobo_auth_tokens_revoked_idx` ON `kobo_auth_tokens` (`revoked_at`);--> statement-breakpoint
CREATE TABLE `kobo_bookmarks` (
	`kobo_reading_state_id` text PRIMARY KEY NOT NULL,
	`last_modified` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`location_source` text,
	`location_type` text,
	`location_value` text,
	`progress_percent` real,
	`content_source_progress_percent` real,
	FOREIGN KEY (`kobo_reading_state_id`) REFERENCES `kobo_reading_states`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kobo_bookmarks_last_modified_idx` ON `kobo_bookmarks` (`last_modified`);--> statement-breakpoint
CREATE TABLE `kobo_reading_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`status` text DEFAULT 'ReadyToRead' NOT NULL,
	`last_time_started_reading` integer,
	`times_started_reading` integer DEFAULT 0 NOT NULL,
	`last_modified` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`priority_timestamp` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kobo_reading_states_user_idx` ON `kobo_reading_states` (`user_id`);--> statement-breakpoint
CREATE INDEX `kobo_reading_states_book_idx` ON `kobo_reading_states` (`book_id`);--> statement-breakpoint
CREATE INDEX `kobo_reading_states_user_book_idx` ON `kobo_reading_states` (`user_id`,`book_id`);--> statement-breakpoint
CREATE INDEX `kobo_reading_states_last_modified_idx` ON `kobo_reading_states` (`last_modified`);--> statement-breakpoint
CREATE TABLE `kobo_statistics` (
	`kobo_reading_state_id` text PRIMARY KEY NOT NULL,
	`last_modified` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`remaining_time_minutes` integer,
	`spent_reading_minutes` integer,
	FOREIGN KEY (`kobo_reading_state_id`) REFERENCES `kobo_reading_states`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kobo_statistics_last_modified_idx` ON `kobo_statistics` (`last_modified`);--> statement-breakpoint
CREATE TABLE `kobo_synced_books` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`book_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kobo_synced_books_user_idx` ON `kobo_synced_books` (`user_id`);--> statement-breakpoint
CREATE INDEX `kobo_synced_books_book_idx` ON `kobo_synced_books` (`book_id`);--> statement-breakpoint
CREATE INDEX `kobo_synced_books_user_book_idx` ON `kobo_synced_books` (`user_id`,`book_id`);--> statement-breakpoint
CREATE INDEX `kobo_synced_books_created_idx` ON `kobo_synced_books` (`created_at`);--> statement-breakpoint
CREATE TABLE `shelf_archive` (
	`id` text PRIMARY KEY NOT NULL,
	`shelf_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_modified` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shelf_archive_user_idx` ON `shelf_archive` (`user_id`);--> statement-breakpoint
CREATE INDEX `shelf_archive_shelf_idx` ON `shelf_archive` (`shelf_id`);--> statement-breakpoint
CREATE INDEX `shelf_archive_last_modified_idx` ON `shelf_archive` (`last_modified`);--> statement-breakpoint
ALTER TABLE `shelf_members` ADD `enable_kobo_sync` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `shelf_members_enable_kobo_sync_idx` ON `shelf_members` (`user_id`,`enable_kobo_sync`);