import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import type { ConversionJobStatus } from "#/db/schema";
import * as schema from "#/db/schema";
import { DatabaseContext } from "#/layers/DatabaseLayer";

export class ConversionJobNotFound extends Data.TaggedError(
	"ConversionJobNotFound",
)<{
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
			status: "pending",
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
	format: string;
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
