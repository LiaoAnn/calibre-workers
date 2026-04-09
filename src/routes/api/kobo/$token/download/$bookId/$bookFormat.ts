import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { KoboFileNotFound } from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import { getBookFile } from "#/services/FileService";
import { getDownloadFileForKobo } from "#/services/KoboService";

export const Route = createFileRoute(
	"/api/kobo/$token/download/$bookId/$bookFormat",
)({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, ({ params }) =>
					Effect.gen(function* () {
						const selected = yield* getDownloadFileForKobo({
							bookId: params.bookId,
							requestedFormat: params.bookFormat,
						});

						// NOTE(gray area): for strict backward compatibility we currently map
						// storage read failures to FileNotFound (404), matching existing behavior.
						const fileObject = yield* getBookFile(selected.file.r2Key).pipe(
							Effect.catchAll(() =>
								Effect.fail(
									new KoboFileNotFound({
										bookId: params.bookId,
										requestedFormat: params.bookFormat,
									}),
								),
							),
						);

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
							response: new Response(fileObject.body, {
								status: 200,
								headers,
							}),
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
