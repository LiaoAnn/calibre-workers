import "@tanstack/react-start/server-only";

import { Duration, Effect } from "effect";
import { DatabaseLive } from "#/layers/DatabaseLayer";
import { failStaleMetadataTasks } from "#/services/BookService";
import { failStaleConversionJobs } from "#/services/ConversionService";

const STALE_TASK_WINDOW = Duration.minutes(45);
const STALE_CONVERSION_ERROR_MESSAGE =
	"Marked as failed by scheduled stale-task sweeper";

export const handleScheduled: ExportedHandlerScheduledHandler<Env> = async (
	controller,
	_env,
	_ctx,
) => {
	const now = Date.now();
	const staleBeforeMs = now - Duration.toMillis(STALE_TASK_WINDOW);
	const staleBefore = new Date(staleBeforeMs);

	const runnable = Effect.gen(function* () {
		const [conversionResult, metadataResult] = yield* Effect.all(
			[
				failStaleConversionJobs({
					staleBefore,
					errorMessage: STALE_CONVERSION_ERROR_MESSAGE,
				}),
				failStaleMetadataTasks({
					staleBookLastModifiedBefore: staleBefore,
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
			});
		});
	});

	await Effect.runPromise(runnable.pipe(Effect.provide(DatabaseLive)));
};
