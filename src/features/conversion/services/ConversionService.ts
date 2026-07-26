import "@tanstack/react-start/server-only";

import { and, eq, inArray, lt } from "drizzle-orm";
import { Data, Effect } from "effect";
import type { BookFileFormat, ConversionJobStatus } from "#/shared/db/schema";
import * as schema from "#/shared/db/schema";
import { DatabaseContext, DatabaseLive } from "#/shared/layers/DatabaseLayer";

class ConversionJobNotFound extends Data.TaggedError("ConversionJobNotFound")<{
	readonly jobId: string;
}> {}

interface CreateConversionJobInput {
	bookId: string;
	sourceFileId: string;
	targetFormat: string;
}

export class ConversionService extends Effect.Service<ConversionService>()(
	"ConversionService",
	{
		accessors: true,
		dependencies: [DatabaseLive],
		effect: Effect.gen(function* () {
			const database = yield* DatabaseContext;

			const createConversionJob = Effect.fn(
				"ConversionService.createConversionJob",
			)(function* (input: CreateConversionJobInput) {
				const id = crypto.randomUUID();

				yield* database.insert(schema.conversionJobs).values({
					id,
					bookId: input.bookId,
					sourceFileId: input.sourceFileId,
					targetFormat: input.targetFormat,
				});

				return { jobId: id };
			});

			const getConversionJob = Effect.fn("ConversionService.getConversionJob")(
				function* (jobId: string) {
					const rows = yield* database
						.select()
						.from(schema.conversionJobs)
						.where(eq(schema.conversionJobs.id, jobId))
						.limit(1);

					const job = rows[0];
					if (!job) {
						return yield* Effect.fail(new ConversionJobNotFound({ jobId }));
					}

					return job;
				},
			);

			const updateConversionJobStatus = Effect.fn(
				"ConversionService.updateConversionJobStatus",
			)(function* (
				jobId: string,
				update: {
					status: ConversionJobStatus;
					resultFileId?: string;
					errorMessage?: string;
				},
			) {
				yield* database
					.update(schema.conversionJobs)
					.set({
						status: update.status,
						resultFileId: update.resultFileId ?? null,
						errorMessage: update.errorMessage ?? null,
					})
					.where(eq(schema.conversionJobs.id, jobId));
			});

			interface CreateBookFileInput {
				bookId: string;
				format: BookFileFormat;
				fileName: string;
				r2Key: string;
				size: number;
				mimeType?: string;
			}

			const createBookFile = Effect.fn("ConversionService.createBookFile")(
				function* (input: CreateBookFileInput) {
					const id = crypto.randomUUID();

					yield* database.insert(schema.bookFiles).values({
						id,
						bookId: input.bookId,
						format: input.format,
						fileName: input.fileName,
						r2Key: input.r2Key,
						mimeType: input.mimeType,
						size: input.size,
					});

					return { fileId: id };
				},
			);

			const failStaleConversionJobs = Effect.fn(
				"ConversionService.failStaleConversionJobs",
			)(function* ({
				staleBefore,
				errorMessage,
			}: {
				staleBefore: Date;
				errorMessage: string;
			}) {
				const staleJobs = yield* database
					.select({ id: schema.conversionJobs.id })
					.from(schema.conversionJobs)
					.where(
						and(
							inArray(schema.conversionJobs.status, ["pending", "processing"]),
							lt(schema.conversionJobs.updatedAt, staleBefore),
						),
					);

				if (staleJobs.length === 0) {
					return { affectedCount: 0 };
				}

				const staleIds = staleJobs.map((job) => job.id);

				yield* database
					.update(schema.conversionJobs)
					.set({
						status: "failed",
						errorMessage,
						updatedAt: new Date(),
					})
					.where(inArray(schema.conversionJobs.id, staleIds));

				return { affectedCount: staleIds.length };
			});

			return {
				createConversionJob,
				getConversionJob,
				updateConversionJobStatus,
				createBookFile,
				failStaleConversionJobs,
			};
		}),
	},
) {}
