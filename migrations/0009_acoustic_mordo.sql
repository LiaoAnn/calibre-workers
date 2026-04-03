CREATE TABLE `metadata_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `metadata_jobs_book_idx` ON `metadata_jobs` (`book_id`);--> statement-breakpoint
CREATE INDEX `metadata_jobs_user_idx` ON `metadata_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `metadata_jobs_status_idx` ON `metadata_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `metadata_jobs_updated_idx` ON `metadata_jobs` (`updated_at`);