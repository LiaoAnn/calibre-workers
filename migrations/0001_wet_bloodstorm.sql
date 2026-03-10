CREATE TABLE `authors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort` text
);
--> statement-breakpoint
CREATE INDEX `authors_name_idx` ON `authors` (`name`);--> statement-breakpoint
CREATE TABLE `book_files` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`format` text NOT NULL,
	`file_name` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime_type` text,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_files_r2_key_unique` ON `book_files` (`r2_key`);--> statement-breakpoint
CREATE INDEX `book_files_book_idx` ON `book_files` (`book_id`);--> statement-breakpoint
CREATE INDEX `book_files_format_idx` ON `book_files` (`format`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`title` text NOT NULL,
	`sort` text,
	`author_sort` text,
	`timestamp` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`pubdate` integer,
	`series_index` real,
	`has_cover` integer DEFAULT false NOT NULL,
	`last_modified` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_uuid_unique` ON `books` (`uuid`);--> statement-breakpoint
CREATE INDEX `books_title_idx` ON `books` (`title`);--> statement-breakpoint
CREATE TABLE `books_authors_link` (
	`book_id` text NOT NULL,
	`author_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `author_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `books_authors_book_idx` ON `books_authors_link` (`book_id`);--> statement-breakpoint
CREATE INDEX `books_authors_author_idx` ON `books_authors_link` (`author_id`);--> statement-breakpoint
CREATE TABLE `books_languages_link` (
	`book_id` text NOT NULL,
	`language_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `language_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`language_id`) REFERENCES `languages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `books_languages_book_idx` ON `books_languages_link` (`book_id`);--> statement-breakpoint
CREATE INDEX `books_languages_language_idx` ON `books_languages_link` (`language_id`);--> statement-breakpoint
CREATE TABLE `books_publishers_link` (
	`book_id` text NOT NULL,
	`publisher_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `publisher_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`publisher_id`) REFERENCES `publishers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `books_publishers_book_idx` ON `books_publishers_link` (`book_id`);--> statement-breakpoint
CREATE INDEX `books_publishers_publisher_idx` ON `books_publishers_link` (`publisher_id`);--> statement-breakpoint
CREATE TABLE `books_ratings_link` (
	`book_id` text NOT NULL,
	`rating_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `rating_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rating_id`) REFERENCES `ratings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `books_ratings_book_idx` ON `books_ratings_link` (`book_id`);--> statement-breakpoint
CREATE INDEX `books_ratings_rating_idx` ON `books_ratings_link` (`rating_id`);--> statement-breakpoint
CREATE TABLE `books_series_link` (
	`book_id` text NOT NULL,
	`series_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `series_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `books_series_book_idx` ON `books_series_link` (`book_id`);--> statement-breakpoint
CREATE INDEX `books_series_series_idx` ON `books_series_link` (`series_id`);--> statement-breakpoint
CREATE TABLE `books_tags_link` (
	`book_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`book_id`, `tag_id`),
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `books_tags_book_idx` ON `books_tags_link` (`book_id`);--> statement-breakpoint
CREATE INDEX `books_tags_tag_idx` ON `books_tags_link` (`tag_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `identifiers_book_idx` ON `identifiers` (`book_id`);--> statement-breakpoint
CREATE INDEX `identifiers_type_idx` ON `identifiers` (`type`);--> statement-breakpoint
CREATE TABLE `languages` (
	`id` text PRIMARY KEY NOT NULL,
	`lang_code` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `languages_lang_code_unique` ON `languages` (`lang_code`);--> statement-breakpoint
CREATE INDEX `languages_code_idx` ON `languages` (`lang_code`);--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort` text
);
--> statement-breakpoint
CREATE INDEX `publishers_name_idx` ON `publishers` (`name`);--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`rating` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort` text
);
--> statement-breakpoint
CREATE INDEX `series_name_idx` ON `series` (`name`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE INDEX `tags_name_idx` ON `tags` (`name`);