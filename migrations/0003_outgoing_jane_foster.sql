ALTER TABLE `books` RENAME COLUMN "author_sort" TO "authors";--> statement-breakpoint
DROP TABLE `authors`;--> statement-breakpoint
DROP TABLE `books_authors_link`;