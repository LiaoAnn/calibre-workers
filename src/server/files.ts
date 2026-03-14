import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import * as schema from "#/db/schema";
import { AppLayer } from "#/layers/AppLayer";
import { DatabaseContext } from "#/layers/DatabaseLayer";
import { r2Keys } from "#/lib/r2-keys";
import { requiredSessionMiddleware } from "#/middleware/auth";
import { createBookFromUpload, deleteBook } from "#/services/BookService";
import type { EpubMetadata } from "#/services/EpubService";
import { parseEpubCover, parseEpubMetadata } from "#/services/EpubService";
import { deleteBookFile, uploadBookFile } from "#/services/FileService";

class UploadError extends Data.TaggedError("UploadError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export const uploadBookServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: FormData) => input)
	.handler(async ({ data, context }) => {
		const file = data.get("file");
		const author = data.get("author");
		const title = data.get("title");

		if (!(file instanceof File)) {
			throw new Error("Missing file");
		}

		// Create upload task record
		const taskId = crypto.randomUUID();
		const userId = context.session.user.id;

		// Use streaming instead of buffering entire file
		const fileStream = file.stream();
		const isEpub =
			file.name.toLowerCase().endsWith(".epub") || file.type.includes("epub");

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;

			// Create upload task record
			yield* database.insert(schema.uploadTasks).values({
				id: taskId,
				userId,
				fileName: file.name,
				status: "processing",
			});

			// For metadata extraction, we still need to read the file
			// but we can do it in chunks for EPUB parsing
			const fileBuffer = yield* Effect.tryPromise({
				try: () => file.arrayBuffer(),
				catch: (cause) =>
					new UploadError({ message: "Failed to read file", cause }),
			});

			const extractedMetadata: EpubMetadata = isEpub
				? yield* parseEpubMetadata(fileBuffer).pipe(
						Effect.catchAll(() => Effect.succeed({} as EpubMetadata)),
					)
				: ({} as EpubMetadata);

			const cover = isEpub
				? yield* parseEpubCover(fileBuffer).pipe(
						Effect.catchAll(() => Effect.succeed(undefined)),
					)
				: undefined;

			const resolvedTitle =
				typeof title === "string" && title.trim().length > 0
					? title.trim()
					: extractedMetadata.title?.trim() ||
						file.name.replace(/\.[^.]+$/, "");

			const resolvedAuthors =
				typeof author === "string" && author.trim().length > 0
					? [author.trim()]
					: (extractedMetadata.authors?.filter((a) => a.trim().length > 0) ??
						[]);

			const resolvedPubdate = extractedMetadata.pubdate
				? (() => {
						const d = new Date(extractedMetadata.pubdate as string);
						return Number.isNaN(d.getTime()) ? undefined : d;
					})()
				: undefined;

			// Track created resources for rollback (using a mutable ref pattern)
			// This is acceptable in Effect for resource cleanup scenarios
			const createdResources = {
				bookId: undefined as string | undefined,
				fileR2Key: undefined as string | undefined,
				coverR2Key: undefined as string | undefined,
			};

			// Rollback helper
			const performRollback = () =>
				Effect.gen(function* () {
					if (createdResources.fileR2Key) {
						yield* deleteBookFile(createdResources.fileR2Key).pipe(
							Effect.catchAll(() => Effect.succeed(undefined)),
						);
					}
					if (createdResources.coverR2Key) {
						yield* deleteBookFile(createdResources.coverR2Key).pipe(
							Effect.catchAll(() => Effect.succeed(undefined)),
						);
					}
					if (createdResources.bookId) {
						yield* deleteBook(createdResources.bookId).pipe(
							Effect.catchAll(() => Effect.succeed(undefined)),
						);
					}
				});

			// Main upload effect
			const uploadEffect = Effect.gen(function* () {
				const created = yield* createBookFromUpload({
					title: resolvedTitle,
					authors: resolvedAuthors,
					description: extractedMetadata.description,
					publisher: extractedMetadata.publisher,
					tags: extractedMetadata.tags,
					language: extractedMetadata.language,
					pubdate: resolvedPubdate,
					series: extractedMetadata.series,
					seriesIndex: extractedMetadata.seriesIndex,
					identifiers: extractedMetadata.identifiers,
					fileName: file.name,
					mimeType: file.type || undefined,
					size: file.size,
					hasCover: !!cover,
				});

				// Track resources for potential rollback
				createdResources.bookId = created.book.id;
				createdResources.fileR2Key = created.file.r2Key;

				// Upload main file using stream
				yield* uploadBookFile({
					r2Key: created.file.r2Key,
					body: fileStream,
					contentType: file.type || undefined,
				});

				// Upload cover if exists
				if (cover) {
					createdResources.coverR2Key = r2Keys.bookCover({
						bookId: created.book.id,
					});
					yield* uploadBookFile({
						r2Key: createdResources.coverR2Key,
						body: cover.data,
						contentType: cover.mimeType,
					});
				}

				// Update task to success
				yield* database
					.update(schema.uploadTasks)
					.set({
						status: "success",
						bookId: created.book.id,
					})
					.where(eq(schema.uploadTasks.id, taskId));

				return {
					bookId: created.book.id,
					title: created.book.title,
					taskId,
				};
			});

			// Execute with onExit for cleanup and error handling
			return yield* uploadEffect.pipe(
				Effect.onExit((exit) => {
					// Only rollback on failure (includes interruption)
					if (exit._tag === "Failure") {
						return performRollback();
					}
					return Effect.succeed(undefined);
				}),
				Effect.catchAll((error) =>
					Effect.gen(function* () {
						// Update task to failed
						yield* database
							.update(schema.uploadTasks)
							.set({
								status: "failed",
								errorMessage:
									error instanceof Error ? error.message : "Upload failed",
							})
							.where(eq(schema.uploadTasks.id, taskId));

						return yield* Effect.fail(
							new UploadError({
								message:
									error instanceof Error ? error.message : "Upload failed",
								cause: error,
							}),
						);
					}),
				),
			);
		});

		return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
	});
