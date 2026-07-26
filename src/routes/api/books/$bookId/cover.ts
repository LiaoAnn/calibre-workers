import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { FileService } from "#/features/files/services/FileService";
import { ServerRuntime } from "#/shared/layers/AppRuntime";
import { r2Keys } from "#/shared/lib/r2-keys";

const noStore = { "cache-control": "no-store" };

export const Route = createFileRoute("/api/books/$bookId/cover")({
	server: {
		handlers: {
			GET: async ({ params }: { params: { bookId: string } }) => {
				const coverObject = await ServerRuntime.runPromise(
					FileService.getBookFile(
						r2Keys.bookCover({ bookId: params.bookId }),
					).pipe(
						// A book without a cover is ordinary, so it gets its own tag and a
						// 404. Anything else is a real storage failure: log the cause and
						// report 500.
						Effect.catchTag("ObjectNotFound", () =>
							Effect.succeed(
								new Response("Not found", { status: 404, headers: noStore }),
							),
						),
						Effect.catchTag("StorageError", (error) =>
							Effect.logError("failed to load cover", error).pipe(
								Effect.as(
									new Response("Failed to load cover", {
										status: 500,
										headers: noStore,
									}),
								),
							),
						),
					),
				);

				if (coverObject instanceof Response) {
					return coverObject;
				}

				const headers = new Headers();
				headers.set(
					"content-type",
					coverObject.httpMetadata?.contentType ?? "image/jpeg",
				);
				headers.set("cache-control", "public, max-age=31536000, immutable");

				return new Response(coverObject.body, { status: 200, headers });
			},
		},
	},
});
