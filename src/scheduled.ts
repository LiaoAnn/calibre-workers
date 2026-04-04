import "@tanstack/react-start/server-only";

import { Duration, Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { failStaleMetadataTasks } from "#/services/BookService";
import { failStaleConversionJobs } from "#/services/ConversionService";
import { failStaleUploadTasks } from "#/services/FileService";

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
	const now = Date.now();
	const staleBeforeMs = now - Duration.toMillis(STALE_TASK_WINDOW);
	const staleBefore = new Date(staleBeforeMs);

	const runnable = Effect.gen(function* () {
		const [conversionResult, metadataResult, uploadResult] = yield* Effect.all(
			[
				failStaleConversionJobs({
					staleBefore,
					errorMessage: STALE_CONVERSION_ERROR_MESSAGE,
				}),
				failStaleMetadataTasks({
					staleBefore,
					errorMessage: STALE_METADATA_ERROR_MESSAGE,
				}),
				failStaleUploadTasks({
					staleBefore,
					errorMessage: STALE_UPLOAD_ERROR_MESSAGE,
				}),
			],
			{ concurrency: "unbounded" },
		);

		yield* Effect.sync(() => {
			console.log("[scheduled] stale task sweep completed", {
				cron: controller.cron,
				staleBeforeMs,
				conversionAffected: conversionResult.affectedCount,
				metadataAffected: metadataResult.affectedCount,
				uploadAffected: uploadResult.affectedCount,
			});
		});
	});

	await Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
};
