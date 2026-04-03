import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { requiredSessionMiddleware } from "#/middleware/auth";
import { createConversionJob } from "#/services/ConversionService";

interface TriggerConversionInput {
	bookId: string;
	fileId: string;
	targetFormat: string;
}

export const triggerConversionServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: TriggerConversionInput) => input)
	.handler(async ({ data }) => {
		const { jobId } = await Effect.runPromise(
			createConversionJob({
				bookId: data.bookId,
				sourceFileId: data.fileId,
				targetFormat: data.targetFormat,
			}).pipe(
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);

		await env.CONVERSION_QUEUE.send({ jobId });

		return { jobId };
	});
