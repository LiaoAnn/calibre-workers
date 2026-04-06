DROP TABLE `shelf_archive`;--> statement-breakpoint
ALTER TABLE `shelf_members` ADD `kobo_sync_disabled_at` integer;--> statement-breakpoint
CREATE INDEX `shelf_members_kobo_sync_disabled_idx` ON `shelf_members` (`user_id`,`kobo_sync_disabled_at`);--> statement-breakpoint
ALTER TABLE `shelves` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `shelves_deleted_at_idx` ON `shelves` (`deleted_at`);