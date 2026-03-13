import "@tanstack/react-start/server-only";

import { Effect } from "effect";
import { AppLayerWithContainer } from "#/layers/AppLayer";
import { ConverterContainerContext } from "#/layers/ConverterContainerLayer";
import { r2Keys } from "#/lib/r2-keys";
import {
	createBookFile,
	getConversionJob,
	updateConversionJobStatus,
} from "#/services/ConversionService";
import {
	getBookFile,
	getBookFileRecord,
	uploadBookFile,
} from "#/services/FileService";

function mimeTypeForFormat(format: string) {
	switch (format.toLowerCase()) {
		case "epub":
		case "kepub":
			return "application/epub+zip";
		case "mobi":
			return "application/x-mobipocket-ebook";
		case "azw3":
			return "application/vnd.amazon.mobi8-ebook";
		case "pdf":
			return "application/pdf";
		default:
			return "application/octet-stream";
	}
}

export const handleConversionQueue: ExportedHandlerQueueHandler<
	Env,
	{ jobId: string }
> = async (batch, _env) => {
	for (const message of batch.messages) {
		const { jobId } = message.body;

		const runnable = Effect.gen(function* () {
			const job = yield* getConversionJob(jobId);

			yield* updateConversionJobStatus(jobId, { status: "processing" });

			const fileRecord = yield* getBookFileRecord(job.bookId, job.sourceFileId);

			const r2Object = yield* getBookFile(fileRecord.r2Key);
			const bytes = yield* Effect.tryPromise({
				try: () => r2Object.arrayBuffer(),
				catch: (cause) => new Error(`arrayBuffer failed: ${String(cause)}`),
			});

			const container = yield* ConverterContainerContext;
			const converted = yield* container.convert(
				bytes,
				fileRecord.format,
				job.targetFormat,
			);

			const baseName = fileRecord.fileName.replace(/\.[^.]+$/, "");
			const resultFileName = `${baseName}.${job.targetFormat}`;
			const resultR2Key = r2Keys.bookFile({
				bookId: job.bookId,
				fileName: resultFileName,
			});

			yield* uploadBookFile({
				r2Key: resultR2Key,
				body: converted,
				contentType: mimeTypeForFormat(job.targetFormat),
			});

			const { fileId: resultFileId } = yield* createBookFile({
				bookId: job.bookId,
				format: job.targetFormat,
				fileName: resultFileName,
				r2Key: resultR2Key,
				size: converted.byteLength,
				mimeType: mimeTypeForFormat(job.targetFormat),
			});

			yield* updateConversionJobStatus(jobId, {
				status: "done",
				resultFileId,
			});
		});

		await Effect.runPromise(
			runnable.pipe(
				Effect.catchAll((error) =>
					updateConversionJobStatus(jobId, {
						status: "failed",
						errorMessage: String(error),
					}).pipe(Effect.catchAll(() => Effect.void)),
				),
				Effect.provide(AppLayerWithContainer),
			),
		);

		message.ack();
	}
};
