import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";
import { ConversionService } from "#/features/conversion/services/ConversionService";
import { requiredSessionMiddleware } from "#/shared/auth/middleware";
import { runServerEffect } from "#/shared/server/runServerEffect";
import { validateInput } from "#/shared/server/validateInput";

const TriggerConversionInput = Schema.Struct({
	bookId: Schema.NonEmptyString,
	fileId: Schema.NonEmptyString,
	targetFormat: Schema.NonEmptyString,
});

export const triggerConversionServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator(validateInput(TriggerConversionInput))
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
