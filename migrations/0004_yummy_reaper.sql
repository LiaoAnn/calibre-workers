DROP TABLE `books_languages_link`;--> statement-breakpoint
DROP TABLE `books_publishers_link`;--> statement-breakpoint
DROP TABLE `books_ratings_link`;--> statement-breakpoint
DROP TABLE `books_series_link`;--> statement-breakpoint
DROP TABLE `languages`;--> statement-breakpoint
DROP TABLE `ratings`;--> statement-breakpoint
ALTER TABLE `books` ADD `series_id` text REFERENCES series(id);--> statement-breakpoint
ALTER TABLE `books` ADD `language` text;--> statement-breakpoint
ALTER TABLE `books` ADD `publisher_id` text REFERENCES publishers(id);--> statement-breakpoint
ALTER TABLE `books` ADD `rating` integer;--> statement-breakpoint
CREATE INDEX `books_series_idx` ON `books` (`series_id`);--> statement-breakpoint
CREATE INDEX `books_publisher_idx` ON `books` (`publisher_id`);