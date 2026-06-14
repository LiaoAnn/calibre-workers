import "@tanstack/react-start/server-only";

import { and, eq, inArray, lt } from "drizzle-orm";
import { Data, Effect } from "effect";
import type { BookFileFormat, ConversionJobStatus } from "#/shared/db/schema";
import * as schema from "#/shared/db/schema";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";

class ConversionJobNotFound extends Data.TaggedError("ConversionJobNotFound")<{
	readonly jobId: string;
}> {}

interface CreateConversionJobInput {
	bookId: string;
	sourceFileId: string;
	targetFormat: string;
}

export const createConversionJob = (input: CreateConversionJobInput) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
		const id = crypto.randomUUID();

		yield* database.insert(schema.conversionJobs).values({
			id,
			bookId: input.bookId,
			sourceFileId: input.sourceFileId,
			targetFormat: input.targetFormat,
		});

		return { jobId: id };
	});

export const getConversionJob = (jobId: string) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

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
	});

export const updateConversionJobStatus = (
	jobId: string,
	update: {
		status: ConversionJobStatus;
		resultFileId?: string;
		errorMessage?: string;
	},
) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;

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

export const createBookFile = (input: CreateBookFileInput) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
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
	});

export const failStaleConversionJobs = ({
	staleBefore,
	errorMessage,
}: {
	staleBefore: Date;
	errorMessage: string;
}) =>
	Effect.gen(function* () {
		const database = yield* DatabaseContext;
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
