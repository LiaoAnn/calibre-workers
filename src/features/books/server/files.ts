import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import {
	BOOK_MAX_UPLOAD_SIZE_BYTES,
	validateBookUploadFile,
} from "#/features/books/lib/book-upload-validation";
import {
	COVER_MAX_UPLOAD_SIZE_BYTES,
	type CoverValidationIssue,
	validateCoverFile,
} from "#/features/books/lib/cover-validation";
import { BookService } from "#/features/books/services/BookService";
import { EpubService } from "#/features/files/services/EpubService";
import { FileService } from "#/features/files/services/FileService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import * as schema from "#/shared/db/schema";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";
import { r2Keys } from "#/shared/lib/r2-keys";
import { runServerEffect } from "#/shared/server/runServerEffect";

class UploadError extends Data.TaggedError("UploadError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

const R2_MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;
const R2_MULTIPART_MAX_PARTS = 10_000;

const resolveTitle = (title: string | undefined, fileName: string) => {
	const trimmed = title?.trim();
	if (trimmed) {
		return trimmed;
	}

	return fileName.replace(/\.[^.]+$/, "");
};

const resolveAuthorsFromMetadata = (
	author: string | undefined,
	fallbackAuthors: string[] | undefined,
) => {
	const trimmed = author?.trim();
	const resolved = trimmed ? [trimmed] : [];
	if (resolved.length > 0) {
		return resolved;
	}

	return (fallbackAuthors ?? [])
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
};

const resolvePubdate = (pubdate: string | undefined): Date | undefined => {
	if (!pubdate) {
		return undefined;
	}

	const parsed = new Date(pubdate);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const uploadTaskNotFound = (taskId: string) =>
	new UploadError({ message: `Upload task not found: ${taskId}` });

const coverValidationErrorMessage = (issue: CoverValidationIssue): string => {
	switch (issue) {
		case "unsupported-type":
			return "Unsupported cover format. Please upload an image file.";
		case "empty-file":
			return "Cover file is empty.";
		case "too-large":
			return `Cover file is too large. Maximum size is ${Math.floor(COVER_MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))}MB.`;
	}
};

export const uploadBookCoverTempServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: FormData) => input)
	.handler(async ({ data }) => {
		const bookId = data.get("bookId");
		const file = data.get("file");

		if (typeof bookId !== "string" || bookId.trim().length === 0) {
			throw new Error("Missing bookId");
		}

		if (!(file instanceof File)) {
			throw new Error("Missing cover file");
		}

		const coverValidationIssue = validateCoverFile(file);
		if (coverValidationIssue) {
			throw new UploadError({
				message: coverValidationErrorMessage(coverValidationIssue),
			});
		}

		const tempR2Key = r2Keys.bookCoverTemp({
			bookId: bookId.trim(),
			tempId: crypto.randomUUID(),
		});

		const bytes = await file.arrayBuffer();
		if (bytes.byteLength !== file.size) {
			throw new UploadError({
				message:
					"Invalid or incomplete upload. Cover size does not match payload.",
			});
		}

		await runServerEffect(
			FileService.uploadBookFile({
				r2Key: tempR2Key,
				body: bytes,
				contentType: file.type || undefined,
				expectedSize: file.size,
			}),
		);

		return {
			tempR2Key,
		};
	});

interface CreateBookUploadSessionInput {
	fileName: string;
	fileSize: number;
	mimeType?: string;
}

export const createBookUploadSessionServerFn = createServerFn({
	method: "POST",
})
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: CreateBookUploadSessionInput) => input)
	.handler(async ({ data, context }) => {
		const userId = context.session.user.id;
		const fileName = data.fileName?.trim();

		if (!fileName) {
			throw new UploadError({ message: "Missing file name" });
		}

		if (!Number.isFinite(data.fileSize) || data.fileSize <= 0) {
			throw new UploadError({ message: "Invalid file size" });
		}

		const validationIssue = validateBookUploadFile({
			name: fileName,
			type: data.mimeType,
			size: data.fileSize,
		});
		if (validationIssue) {
			switch (validationIssue) {
				case "unsupported-type":
					throw new UploadError({
						message: "Unsupported file format. Only .epub is allowed.",
					});
				case "empty-file":
					throw new UploadError({ message: "Invalid file size" });
				case "too-large":
					throw new UploadError({
						message: `File too large. Maximum supported size is ${Math.floor(BOOK_MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))}MB.`,
					});
			}
		}

		const totalParts = Math.ceil(data.fileSize / R2_MULTIPART_PART_SIZE_BYTES);
		if (totalParts > R2_MULTIPART_MAX_PARTS) {
			throw new UploadError({
				message: "File is too large for multipart upload configuration.",
			});
		}

		const taskId = crypto.randomUUID();
		const stagingR2Key = r2Keys.bookUploadStaging({
			userId,
			taskId,
			fileName,
		});

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;

			yield* database.insert(schema.uploadTasks).values({
				id: taskId,
				userId,
				fileName,
			});

			const multipart = yield* FileService.createMultipartUpload({
				r2Key: stagingR2Key,
				contentType: data.mimeType || undefined,
				customMetadata: {
					taskId,
					userId,
					fileName,
				},
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* () {
						yield* database
							.update(schema.uploadTasks)
							.set({
								status: "failed",
								errorMessage: "Failed to initialize multipart upload",
							})
							.where(eq(schema.uploadTasks.id, taskId));

						return yield* Effect.fail(error);
					}),
				),
			);

			yield* database
				.update(schema.uploadTasks)
				.set({
					status: "processing",
					stagingR2Key,
					multipartUploadId: multipart.uploadId,
				})
				.where(eq(schema.uploadTasks.id, taskId));

			return {
				taskId,
				partSizeBytes: R2_MULTIPART_PART_SIZE_BYTES,
				totalParts,
			};
		});

		return runServerEffect(runnable);
	});

export const uploadBookPartServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: FormData) => input)
	.handler(async ({ data, context }) => {
		const taskId = data.get("taskId");
		const partNumberRaw = data.get("partNumber");
		const part = data.get("part");

		if (typeof taskId !== "string" || taskId.trim().length === 0) {
			throw new UploadError({ message: "Missing taskId" });
		}

		if (
			typeof partNumberRaw !== "string" ||
			partNumberRaw.trim().length === 0
		) {
			throw new UploadError({ message: "Missing partNumber" });
		}

		const partNumber = Number.parseInt(partNumberRaw, 10);
		if (!Number.isInteger(partNumber) || partNumber <= 0) {
			throw new UploadError({ message: "Invalid partNumber" });
		}

		if (!(part instanceof File)) {
			throw new UploadError({ message: "Missing upload part" });
		}

		const userId = context.session.user.id;

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;
			const rows = yield* database
				.select()
				.from(schema.uploadTasks)
				.where(
					and(
						eq(schema.uploadTasks.id, taskId),
						eq(schema.uploadTasks.userId, userId),
					),
				)
				.limit(1);

			const task = rows[0];
			if (!task) {
				return yield* Effect.fail(uploadTaskNotFound(taskId));
			}

			if (task.status === "success" || task.status === "failed") {
				return yield* Effect.fail(
					new UploadError({
						message: `Upload task is already ${task.status}`,
					}),
				);
			}

			if (!task.stagingR2Key || !task.multipartUploadId) {
				return yield* Effect.fail(
					new UploadError({ message: "Upload session is not initialized" }),
				);
			}

			const uploadedPart = yield* FileService.uploadMultipartPart({
				r2Key: task.stagingR2Key,
				uploadId: task.multipartUploadId,
				partNumber,
				body: part.stream(),
			});

			yield* database
				.update(schema.uploadTasks)
				.set({
					status: "processing",
					errorMessage: null,
				})
				.where(eq(schema.uploadTasks.id, task.id));

			return {
				partNumber: uploadedPart.partNumber,
				eTag: uploadedPart.etag,
			};
		});

		return runServerEffect(runnable);
	});

interface CompleteBookUploadInput {
	taskId: string;
	parts: Array<{ partNumber: number; eTag: string }>;
	fileSize: number;
	mimeType?: string;
	title?: string;
	author?: string;
}

export const completeBookUploadServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: CompleteBookUploadInput) => input)
	.handler(async ({ data, context }) => {
		if (!data.taskId || data.taskId.trim().length === 0) {
			throw new UploadError({ message: "Missing taskId" });
		}

		if (!Number.isFinite(data.fileSize) || data.fileSize <= 0) {
			throw new UploadError({ message: "Invalid file size" });
		}

		if (!Array.isArray(data.parts) || data.parts.length === 0) {
			throw new UploadError({ message: "Missing uploaded parts" });
		}

		const userId = context.session.user.id;

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;
			const rows = yield* database
				.select()
				.from(schema.uploadTasks)
				.where(
					and(
						eq(schema.uploadTasks.id, data.taskId),
						eq(schema.uploadTasks.userId, userId),
					),
				)
				.limit(1);

			const task = rows[0];
			if (!task) {
				return yield* Effect.fail(uploadTaskNotFound(data.taskId));
			}

			if (task.status === "success" && task.bookId) {
				return {
					bookId: task.bookId,
					title: resolveTitle(data.title, task.fileName),
					taskId: task.id,
				};
			}

			if (!task.stagingR2Key || !task.multipartUploadId) {
				return yield* Effect.fail(
					new UploadError({ message: "Upload session is not initialized" }),
				);
			}

			const stagingR2Key = task.stagingR2Key;
			const multipartUploadId = task.multipartUploadId;

			const partMap = new Map<number, string>();
			for (const part of data.parts) {
				if (!Number.isInteger(part.partNumber) || part.partNumber <= 0) {
					return yield* Effect.fail(
						new UploadError({ message: "Invalid uploaded part number" }),
					);
				}

				if (typeof part.eTag !== "string" || part.eTag.trim().length === 0) {
					return yield* Effect.fail(
						new UploadError({ message: "Invalid uploaded part etag" }),
					);
				}

				partMap.set(part.partNumber, part.eTag);
			}

			const uploadedParts: R2UploadedPart[] = Array.from(partMap.entries())
				.sort((a, b) => a[0] - b[0])
				.map(([partNumber, etag]) => ({ partNumber, etag }));

			if (uploadedParts.length === 0) {
				return yield* Effect.fail(
					new UploadError({ message: "No uploaded parts to complete" }),
				);
			}

			const createdResources = {
				bookId: undefined as string | undefined,
				fileR2Key: undefined as string | undefined,
				coverR2Key: undefined as string | undefined,
			};

			const performRollback = () =>
				Effect.gen(function* () {
					if (createdResources.fileR2Key) {
						yield* FileService.deleteBookFile(createdResources.fileR2Key).pipe(
							Effect.catchAll(() => Effect.succeed(undefined)),
						);
					}

					if (createdResources.coverR2Key) {
						yield* FileService.deleteBookFile(createdResources.coverR2Key).pipe(
							Effect.catchAll(() => Effect.succeed(undefined)),
						);
					}

					if (createdResources.bookId) {
						yield* BookService.deleteBook(createdResources.bookId).pipe(
							Effect.catchAll(() => Effect.succeed(undefined)),
						);
					}

					yield* FileService.deleteBookFile(stagingR2Key).pipe(
						Effect.catchAll(() => Effect.succeed(undefined)),
					);
				});

			const completeEffect = Effect.gen(function* () {
				const completedObject = yield* FileService.completeMultipartUpload({
					r2Key: stagingR2Key,
					uploadId: multipartUploadId,
					uploadedParts,
				});

				if (completedObject.size !== data.fileSize) {
					return yield* Effect.fail(
						new UploadError({
							message:
								"Invalid or incomplete upload. File size does not match payload.",
						}),
					);
				}

				const parsedEpub = yield* EpubService.parseEpubMetadataAndCoverFromR2({
					r2Key: stagingR2Key,
				});

				const resolvedTitle = resolveTitle(
					data.title ?? parsedEpub.metadata.title,
					task.fileName,
				);
				const resolvedAuthors = resolveAuthorsFromMetadata(
					data.author,
					parsedEpub.metadata.authors,
				);
				const resolvedPubdate = resolvePubdate(parsedEpub.metadata.pubdate);

				const stagedObject = yield* FileService.getBookFile(stagingR2Key);
				if (!stagedObject.body) {
					return yield* Effect.fail(
						new UploadError({ message: "Uploaded file body is empty" }),
					);
				}

				const created = yield* BookService.createBookFromUpload({
					title: resolvedTitle,
					authors: resolvedAuthors,
					description: parsedEpub.metadata.description,
					publisher: parsedEpub.metadata.publisher,
					tags: parsedEpub.metadata.tags,
					language: parsedEpub.metadata.language,
					pubdate: resolvedPubdate,
					series: parsedEpub.metadata.series,
					seriesIndex: parsedEpub.metadata.seriesIndex,
					identifiers: parsedEpub.metadata.identifiers,
					fileName: task.fileName,
					mimeType:
						data.mimeType ||
						stagedObject.httpMetadata?.contentType ||
						undefined,
					size: data.fileSize,
					hasCover: Boolean(parsedEpub.cover),
				});

				createdResources.bookId = created.book.id;
				createdResources.fileR2Key = created.file.r2Key;

				yield* FileService.uploadBookFile({
					r2Key: created.file.r2Key,
					body: stagedObject.body,
					contentType:
						data.mimeType ||
						stagedObject.httpMetadata?.contentType ||
						undefined,
					expectedSize: data.fileSize,
				});

				if (parsedEpub.cover) {
					const coverR2Key = r2Keys.bookCover({
						bookId: created.book.id,
					});
					createdResources.coverR2Key = coverR2Key;

					yield* FileService.uploadBookFile({
						r2Key: coverR2Key,
						body: parsedEpub.cover.data,
						contentType: parsedEpub.cover.mimeType,
						expectedSize: parsedEpub.cover.data.byteLength,
					});
				}

				yield* FileService.deleteBookFile(stagingR2Key);

				yield* database
					.update(schema.uploadTasks)
					.set({
						status: "success",
						bookId: created.book.id,
						errorMessage: null,
						stagingR2Key: null,
						multipartUploadId: null,
					})
					.where(eq(schema.uploadTasks.id, task.id));

				return {
					bookId: created.book.id,
					title: created.book.title,
					taskId: task.id,
				};
			});

			return yield* completeEffect.pipe(
				Effect.onExit((exit) => {
					if (exit._tag === "Failure") {
						return performRollback();
					}

					return Effect.succeed(undefined);
				}),
				Effect.catchAll((error) =>
					Effect.gen(function* () {
						if (task.stagingR2Key && task.multipartUploadId) {
							yield* FileService.abortMultipartUpload({
								r2Key: stagingR2Key,
								uploadId: multipartUploadId,
							}).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
						}

						const message =
							error instanceof Error ? error.message : "Upload failed";

						yield* database
							.update(schema.uploadTasks)
							.set({
								status: "failed",
								errorMessage: message,
								stagingR2Key: null,
								multipartUploadId: null,
							})
							.where(eq(schema.uploadTasks.id, task.id));

						return yield* Effect.fail(
							new UploadError({ message, cause: error }),
						);
					}),
				),
			);
		});

		return runServerEffect(runnable);
	});

interface AbortBookUploadInput {
	taskId: string;
	reason?: string;
}

export const abortBookUploadServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: AbortBookUploadInput) => input)
	.handler(async ({ data, context }) => {
		if (!data.taskId || data.taskId.trim().length === 0) {
			throw new UploadError({ message: "Missing taskId" });
		}

		const userId = context.session.user.id;

		const runnable = Effect.gen(function* () {
			const database = yield* DatabaseContext;
			const rows = yield* database
				.select()
				.from(schema.uploadTasks)
				.where(
					and(
						eq(schema.uploadTasks.id, data.taskId),
						eq(schema.uploadTasks.userId, userId),
					),
				)
				.limit(1);

			const task = rows[0];
			if (!task) {
				return { success: true };
			}

			if (task.status === "success" || task.status === "failed") {
				return { success: true };
			}

			if (task.stagingR2Key && task.multipartUploadId) {
				yield* FileService.abortMultipartUpload({
					r2Key: task.stagingR2Key,
					uploadId: task.multipartUploadId,
				}).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
			}

			if (task.stagingR2Key) {
				yield* FileService.deleteBookFile(task.stagingR2Key).pipe(
					Effect.catchAll(() => Effect.succeed(undefined)),
				);
			}

			yield* database
				.update(schema.uploadTasks)
				.set({
					status: "failed",
					errorMessage: data.reason ?? "Upload aborted by client",
					stagingR2Key: null,
					multipartUploadId: null,
				})
				.where(eq(schema.uploadTasks.id, task.id));

			return { success: true };
		});

		return runServerEffect(runnable);
	});
