import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import * as schema from "#/db/schema";
import { DatabaseContext } from "#/layers/DatabaseLayer";
import {
	createBookFile,
	createConversionJob,
	failStaleConversionJobs,
	getConversionJob,
	updateConversionJobStatus,
} from "#/services/ConversionService";
import { runTest, runTestExit, seedBook, seedBookFile } from "#/test/helpers";

describe("ConversionService", () => {
	it("creates a job, links a result file and transitions to done", async () => {
		const { jobId, resultFileId } = await runTest(
			Effect.gen(function* () {
				const bookId = yield* seedBook();
				const sourceFileId = yield* seedBookFile(bookId, { format: "epub" });

				const { jobId } = yield* createConversionJob({
					bookId,
					sourceFileId,
					targetFormat: "kepub",
				});

				const { fileId } = yield* createBookFile({
					bookId,
					format: "kepub",
					fileName: "out.kepub",
					r2Key: `books/${bookId}/out.kepub`,
					size: 2048,
				});

				yield* updateConversionJobStatus(jobId, {
					status: "done",
					resultFileId: fileId,
				});

				return { jobId, resultFileId: fileId };
			}),
		);

		const job = await runTest(getConversionJob(jobId));
		expect(job.status).toBe("done");
		expect(job.targetFormat).toBe("kepub");
		expect(job.resultFileId).toBe(resultFileId);
	});

	it("fails with ConversionJobNotFound for an unknown id", async () => {
		const exit = await runTestExit(getConversionJob("missing"));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(JSON.stringify(Exit.causeOption(exit))).toContain(
				"ConversionJobNotFound",
			);
		}
	});

	it("failStaleConversionJobs fails only jobs older than the cutoff", async () => {
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

				const fresh = yield* createConversionJob({
					bookId,
					sourceFileId,
					targetFormat: "mobi",
				});
				return { staleJobId, freshJobId: fresh.jobId };
			}),
		);

		const result = await runTest(
			failStaleConversionJobs({
				staleBefore: new Date(Date.now() - 30 * 60 * 1000),
				errorMessage: "stale conversion",
			}),
		);
		expect(result.affectedCount).toBe(1);

		const stale = await runTest(getConversionJob(staleJobId));
		const fresh = await runTest(getConversionJob(freshJobId));
		expect(stale.status).toBe("failed");
		expect(stale.errorMessage).toBe("stale conversion");
		expect(fresh.status).toBe("pending");
	});
});
