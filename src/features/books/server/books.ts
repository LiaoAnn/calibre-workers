import { env } from "cloudflare:workers";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import type { MetadataQueueMessage } from "#/features/books/queue/metadata";
import {
	createMetadataJob,
	getBookById,
	listBookFilesForMetadataSync,
	listBooks,
	setBookFilesMetadataStatus,
	type UpdateBookInput,
	updateBook,
	updateMetadataJobStatus,
} from "#/features/books/services/BookService";
import {
	deleteBookFile,
	getBookFile,
	uploadBookFile,
} from "#/features/files/services/FileService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import { ServerRuntime } from "#/shared/layers/AppRuntime";
import { r2Keys } from "#/shared/lib/r2-keys";

interface ListBooksServerInput {
	page?: number;
	limit?: number;
	author?: string;
}

interface GetBookByIdServerInput {
	bookId: string;
}

interface UpdateBookServerInput extends UpdateBookInput {
	coverTempR2Key?: string;
}

export const listBooksServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: ListBooksServerInput | undefined) => input)
	.handler(async ({ data }) => {
		return ServerRuntime.runPromise(
			listBooks({
				page: data?.page,
				limit: data?.limit,
				author: data?.author,
			}).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);
	});

export const getBookByIdServerFn = createServerFn({ method: "GET" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: GetBookByIdServerInput) => input)
	.handler(async ({ data }) => {
		return ServerRuntime.runPromise(
			getBookById(data.bookId).pipe(
				Effect.catchTag("BookNotFound", () => Effect.die(notFound())),
			),
		);
	});

export const updateBookServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: UpdateBookServerInput) => input)
	.handler(async ({ data, context }) => {
		const { coverTempR2Key, ...bookInput } = data;
		const userId = context.session.user.id;

		const { files, metadataJobId } = await ServerRuntime.runPromise(
			Effect.gen(function* () {
				if (coverTempR2Key) {
					const tempCoverObject = yield* getBookFile(coverTempR2Key);

					yield* uploadBookFile({
						r2Key: r2Keys.bookCover({ bookId: data.bookId }),
						body: tempCoverObject.body,
						contentType: tempCoverObject.httpMetadata?.contentType,
						expectedSize: tempCoverObject.size,
					});

					yield* deleteBookFile(coverTempR2Key);
				}

				yield* updateBook({
					...bookInput,
					hasCover: coverTempR2Key ? true : undefined,
				});
				const files = yield* listBookFilesForMetadataSync(data.bookId);
				let metadataJobId: string | undefined;

				if (files.length > 0) {
					yield* setBookFilesMetadataStatus({
						bookId: data.bookId,
						fileIds: files.map((file) => file.fileId),
						status: "pending",
					});

					const job = yield* createMetadataJob({
						bookId: data.bookId,
						userId,
					});
					metadataJobId = job.jobId;
				}

				return { files, metadataJobId };
			}).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);

		if (files.length > 0 && metadataJobId) {
			try {
				await env.METADATA_QUEUE.send({
					jobId: metadataJobId,
				} satisfies MetadataQueueMessage);
			} catch (error) {
				await ServerRuntime.runPromise(
					Effect.all(
						[
							setBookFilesMetadataStatus({
								bookId: data.bookId,
								fileIds: files.map((file) => file.fileId),
								status: "failed",
								onlyIfCurrentStatusIn: ["pending", "processing"],
							}),
							updateMetadataJobStatus(metadataJobId, {
								status: "failed",
								errorMessage: "Failed to enqueue metadata synchronization job",
							}),
						],
						{ discard: true },
					),
				);
				throw error;
			}
		}

		return {
			queuedFileCount: files.length,
			metadataJobId: metadataJobId ?? null,
		};
	});
