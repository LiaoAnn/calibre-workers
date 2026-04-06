import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { koboJsonErrorResponse } from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import { getBookFile } from "#/services/FileService";
import {
	createMissingKepubConversionJobs,
	getDownloadFileForKobo,
} from "#/services/KoboService";

export const Route = createFileRoute(
	"/api/kobo/$token/download/$bookId/$bookFormat",
)({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, async ({ params }) => {
					const fileResult = await Effect.runPromise(
						Effect.either(
							getDownloadFileForKobo({
								bookId: params.bookId,
								requestedFormat: params.bookFormat,
							}).pipe(Effect.provide(AppLayer)),
						),
					);

					if (Either.isLeft(fileResult)) {
						return {
							response: koboJsonErrorResponse({
								status: 404,
								message: "File not found",
								code: "FileNotFound",
							}),
							isHandledInternally: true,
						};
					}

					const selected = fileResult.right;
					if (selected.fallbackToEpub && selected.conversionSourceFileId) {
						// Queue conversion in background so next sync can serve kepub.
						await Effect.runPromise(
							createMissingKepubConversionJobs([
								{
									bookId: params.bookId,
									sourceFileId: selected.conversionSourceFileId,
								},
							]).pipe(Effect.provide(AppLayer)),
						);
					}

					const objectResult = await Effect.runPromise(
						Effect.either(
							getBookFile(selected.file.r2Key).pipe(Effect.provide(AppLayer)),
						),
					);

					if (Either.isLeft(objectResult)) {
						return {
							response: koboJsonErrorResponse({
								status: 404,
								message: "File not found",
								code: "FileNotFound",
							}),
							isHandledInternally: true,
						};
					}

					const headers = new Headers();
					headers.set(
						"content-type",
						selected.file.mimeType || "application/octet-stream",
					);

					const fileName = selected.file.fileName.replace(
						/\.kepub$/i,
						".kepub.epub",
					);
					const encodedFileName = encodeURIComponent(fileName);
					headers.set(
						"content-disposition",
						`attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
					);
					headers.set("cache-control", "no-store");

					return {
						response: new Response(objectResult.right.body, {
							status: 200,
							headers,
						}),
						isHandledInternally: true,
					};
				}),
		},
	},
});
