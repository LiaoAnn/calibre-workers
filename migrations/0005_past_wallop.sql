CREATE TABLE `upload_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`file_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`book_id` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `upload_tasks_user_idx` ON `upload_tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `upload_tasks_status_idx` ON `upload_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `upload_tasks_created_idx` ON `upload_tasks` (`created_at`);