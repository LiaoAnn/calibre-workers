ALTER TABLE `book_files` ADD `metadata_status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
CREATE INDEX `book_files_metadata_status_idx` ON `book_files` (`metadata_status`);