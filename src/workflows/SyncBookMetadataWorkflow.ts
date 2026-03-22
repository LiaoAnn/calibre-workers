import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import * as schema from "#/db/schema";
import { AppLayer, AppLayerWithContainer } from "#/layers/AppLayer";
import { ConverterContainerContext } from "#/layers/ConverterContainerLayer";
import { DatabaseContext } from "#/layers/DatabaseLayer";
import { R2Context } from "#/layers/R2Layer";
import type { SyncBookMetadataParams } from "#/workflows/types";

interface MetadataFileRecord {
	fileId: string;
	r2Key: string;
	format: string;
}

interface MetadataBookRecord {
	bookId: string;
	title: string;
	authors: string[];
	language?: string;
	publisher?: string;
	files: MetadataFileRecord[];
}

function contentTypeForFormat(format: string) {
	switch (format.toLowerCase()) {
		case "epub":
		case "kepub":
			return "application/epub+zip";
		case "mobi":
			return "application/x-mobipocket-ebook";
		case "azw3":
			return "application/vnd.amazon.mobi8-ebook";
		case "txt":
			return "text/plain; charset=utf-8";
		default:
			return "application/octet-stream";
	}
}

export class SyncBookMetadataWorkflow extends WorkflowEntrypoint<
	Env,
	SyncBookMetadataParams
> {
	async run(
		event: Readonly<WorkflowEvent<SyncBookMetadataParams>>,
		step: WorkflowStep,
	): Promise<{ queued: true; bookId: string; fileCount: number }> {
		const payload = event.payload;

		const book = await step.do("load-book-and-files", () => {
			const runnable = Effect.gen(function* () {
				const database = yield* DatabaseContext;

				const bookRows = yield* database
					.select({
						id: schema.books.id,
						title: schema.books.title,
						authors: schema.books.authors,
						language: schema.books.language,
						publisher: schema.publishers.name,
					})
					.from(schema.books)
					.leftJoin(
						schema.publishers,
						eq(schema.publishers.id, schema.books.publisherId),
					)
					.where(eq(schema.books.id, payload.bookId))
					.limit(1);

				const bookResult = bookRows[0];

				if (!bookResult) {
					return yield* Effect.fail(
						new Error(`Book not found: ${payload.bookId}`),
					);
				}

				const files = yield* database
					.select({
						fileId: schema.bookFiles.id,
						r2Key: schema.bookFiles.r2Key,
						format: schema.bookFiles.format,
					})
					.from(schema.bookFiles)
					.where(eq(schema.bookFiles.bookId, payload.bookId));

				return {
					bookId: bookResult.id,
					title: bookResult.title,
					authors: (bookResult.authors ?? "")
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean),
					language: bookResult.language ?? undefined,
					publisher: bookResult.publisher ?? undefined,
					files,
				} satisfies MetadataBookRecord;
			});

			return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
		});

		const fileCount = await step.do("process-book-files", () => {
			const runnable = Effect.gen(function* () {
				if (book.files.length === 0) {
					return 0;
				}

				const storage = yield* R2Context;
				const container = yield* ConverterContainerContext;

				const metadata = {
					title: book.title,
					authors: book.authors,
					language: book.language,
					publisher: book.publisher,
				};

				for (const file of book.files) {
					const source = yield* Effect.tryPromise({
						try: () => storage.get(file.r2Key),
						catch: (cause) =>
							new Error(
								`R2 get failed for ${file.fileId} (${file.r2Key}): ${String(cause)}`,
							),
					});

					if (!source) {
						return yield* Effect.fail(
							new Error(`File not found in R2: ${file.r2Key}`),
						);
					}

					const bytes = yield* Effect.tryPromise({
						try: () => source.arrayBuffer(),
						catch: (cause) =>
							new Error(
								`R2 arrayBuffer failed for ${file.fileId}: ${String(cause)}`,
							),
					});

					const processed = yield* container.process(bytes, {
						formatFrom: file.format,
						formatTo: file.format,
						metadata,
					});

					yield* Effect.tryPromise({
						try: () =>
							storage.put(file.r2Key, processed.bytes, {
								httpMetadata: {
									contentType:
										processed.contentType || contentTypeForFormat(file.format),
								},
							}),
						catch: (cause) =>
							new Error(
								`R2 put failed for ${file.fileId} (${file.r2Key}): ${String(cause)}`,
							),
					});
				}

				return book.files.length;
			});

			return Effect.runPromise(
				runnable.pipe(Effect.provide(AppLayerWithContainer)),
			);
		});

		return step.do("emit-workflow-summary", () =>
			Effect.runPromise(
				Effect.succeed({
					queued: true as const,
					bookId: payload.bookId,
					fileCount,
				}),
			),
		);
	}
}
