import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { ConversionService } from "#/features/conversion/services/ConversionService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import { runServerEffect } from "#/shared/server/runServerEffect";

interface TriggerConversionInput {
	bookId: string;
	fileId: string;
	targetFormat: string;
}

export const triggerConversionServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: TriggerConversionInput) => input)
	.handler(async ({ data }) => {
		const { jobId } = await runServerEffect(
			ConversionService.createConversionJob({
				bookId: data.bookId,
				sourceFileId: data.fileId,
				targetFormat: data.targetFormat,
			}),
		);

		await env.CONVERSION_QUEUE.send({ jobId });

		return { jobId };
	});
