import "@tanstack/react-start/server-only";

import { Duration, Effect } from "effect";
import { BookService } from "#/features/books/services/BookService";
import { ConversionService } from "#/features/conversion/services/ConversionService";
import { FileService } from "#/features/files/services/FileService";
import { QueueRuntime } from "#/shared/layers/AppRuntime";
import { staleBefore } from "#/shared/lib/staleWindow";

const STALE_TASK_WINDOW = Duration.minutes(45);
const STALE_CONVERSION_ERROR_MESSAGE =
	"Marked as failed by scheduled stale-task sweeper";
const STALE_METADATA_ERROR_MESSAGE =
	"Marked as failed by scheduled stale-task sweeper";
const STALE_UPLOAD_ERROR_MESSAGE =
	"Marked as failed by scheduled stale-upload sweeper";

export const handleScheduled: ExportedHandlerScheduledHandler<Env> = async (
	controller,
	_env,
	_ctx,
) => {
	const runnable = Effect.gen(function* () {
		const cutoff = yield* staleBefore(STALE_TASK_WINDOW);

		// Three independent sweeps over different tables; three is the whole
		// population, so the bound is the batch itself.
		const [conversionResult, metadataResult, uploadResult] = yield* Effect.all(
			[
				ConversionService.failStaleConversionJobs({
					staleBefore: cutoff,
					errorMessage: STALE_CONVERSION_ERROR_MESSAGE,
				}),
				BookService.failStaleMetadataTasks({
					staleBefore: cutoff,
					errorMessage: STALE_METADATA_ERROR_MESSAGE,
				}),
				FileService.failStaleUploadTasks({
					staleBefore: cutoff,
					errorMessage: STALE_UPLOAD_ERROR_MESSAGE,
				}),
			],
			{ concurrency: 3 },
		);

		yield* Effect.logInfo("stale task sweep completed", {
			cron: controller.cron,
			staleBeforeMs: cutoff.getTime(),
			conversionAffected: conversionResult.affectedCount,
			metadataAffected: metadataResult.affectedCount,
			uploadAffected: uploadResult.affectedCount,
		});
	});

	await QueueRuntime.runPromise(runnable);
};
