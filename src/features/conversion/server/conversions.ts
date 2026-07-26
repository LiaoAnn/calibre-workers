import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { createConversionJob } from "#/features/conversion/services/ConversionService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import { ServerRuntime } from "#/shared/layers/AppRuntime";

interface TriggerConversionInput {
	bookId: string;
	fileId: string;
	targetFormat: string;
}

export const triggerConversionServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: TriggerConversionInput) => input)
	.handler(async ({ data }) => {
		const { jobId } = await ServerRuntime.runPromise(
			createConversionJob({
				bookId: data.bookId,
				sourceFileId: data.fileId,
				targetFormat: data.targetFormat,
			}).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
			),
		);

		await env.CONVERSION_QUEUE.send({ jobId });

		return { jobId };
	});
