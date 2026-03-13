CREATE TABLE `conversion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`source_file_id` text NOT NULL,
	`target_format` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_file_id` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_file_id`) REFERENCES `book_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_file_id`) REFERENCES `book_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversion_jobs_book_idx` ON `conversion_jobs` (`book_id`);--> statement-breakpoint
CREATE INDEX `conversion_jobs_status_idx` ON `conversion_jobs` (`status`);