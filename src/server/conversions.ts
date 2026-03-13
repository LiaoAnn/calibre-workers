import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { requiredSessionMiddleware } from "#/middleware/auth";
import {
	createConversionJob,
	getConversionJob,
} from "#/services/ConversionService";

interface TriggerConversionInput {
	bookId: string;
	fileId: string;
	targetFormat: string;
}

interface GetConversionJobInput {
	jobId: string;
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

export const getConversionJobServerFn = createServerFn({ method: "GET" })
	.inputValidator((input: GetConversionJobInput) => input)
	.handler(async ({ data }) => {
		return Effect.runPromise(
			getConversionJob(data.jobId).pipe(
				Effect.catchTag("ConversionJobNotFound", () =>
					Effect.die(new Error("Conversion job not found")),
				),
				Effect.catchTag("SqlError", (e) =>
					Effect.die(new Error(`[SqlError] ${String(e.message)}`)),
				),
				Effect.provide(AppLayer),
			),
		);
	});
