import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { ConversionService } from "#/features/conversion/services/ConversionService";
import * as schema from "#/shared/db/schema";
import { DatabaseContext } from "#/shared/layers/DatabaseLayer";
import {
	runTest,
	runTestExit,
	seedBook,
	seedBookFile,
} from "#/shared/test/helpers";

describe("ConversionService", () => {
	it("creates a job, links a result file and transitions to done", async () => {
		const { jobId, resultFileId } = await runTest(
			Effect.gen(function* () {
				const bookId = yield* seedBook();
				const sourceFileId = yield* seedBookFile(bookId, { format: "epub" });

				const { jobId } = yield* ConversionService.createConversionJob({
					bookId,
					sourceFileId,
					targetFormat: "kepub",
				});

				const { fileId } = yield* ConversionService.createBookFile({
					bookId,
					format: "kepub",
					fileName: "out.kepub",
					r2Key: `books/${bookId}/out.kepub`,
					size: 2048,
				});

				yield* ConversionService.updateConversionJobStatus(jobId, {
					status: "done",
					resultFileId: fileId,
				});

				return { jobId, resultFileId: fileId };
			}),
		);

		const job = await runTest(ConversionService.getConversionJob(jobId));
		expect(job.status).toBe("done");
		expect(job.targetFormat).toBe("kepub");
		expect(job.resultFileId).toBe(resultFileId);
	});

	it("fails with ConversionJobNotFound for an unknown id", async () => {
		const exit = await runTestExit(
			ConversionService.getConversionJob("missing"),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(JSON.stringify(Exit.causeOption(exit))).toContain(
				"ConversionJobNotFound",
			);
		}
	});

	it("ConversionService.failStaleConversionJobs fails only jobs older than the cutoff", async () => {
		const oldDate = new Date(Date.now() - 60 * 60 * 1000);

		const { staleJobId, freshJobId } = await runTest(
			Effect.gen(function* () {
				const db = yield* DatabaseContext;
				const bookId = yield* seedBook();
				const sourceFileId = yield* seedBookFile(bookId);

				const staleJobId = crypto.randomUUID();
				yield* db.insert(schema.conversionJobs).values({
					id: staleJobId,
					bookId,
					sourceFileId,
					targetFormat: "kepub",
					status: "processing",
					updatedAt: oldDate,
				});

				const fresh = yield* ConversionService.createConversionJob({
					bookId,
					sourceFileId,
					targetFormat: "mobi",
				});
				return { staleJobId, freshJobId: fresh.jobId };
			}),
		);

		const result = await runTest(
			ConversionService.failStaleConversionJobs({
				staleBefore: new Date(Date.now() - 30 * 60 * 1000),
				errorMessage: "stale conversion",
			}),
		);
		expect(result.affectedCount).toBe(1);

		const stale = await runTest(ConversionService.getConversionJob(staleJobId));
		const fresh = await runTest(ConversionService.getConversionJob(freshJobId));
		expect(stale.status).toBe("failed");
		expect(stale.errorMessage).toBe("stale conversion");
		expect(fresh.status).toBe("pending");
	});
});
