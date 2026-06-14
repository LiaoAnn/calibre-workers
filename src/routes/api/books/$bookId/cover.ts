import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { getBookFile } from "#/features/files/services/FileService";
import { AppLayer } from "#/shared/layers/AppLayer";
import { r2Keys } from "#/shared/lib/r2-keys";

export const Route = createFileRoute("/api/books/$bookId/cover")({
	server: {
		handlers: {
			GET: async ({ params }: { params: { bookId: string } }) => {
				const runnable = getBookFile(
					r2Keys.bookCover({ bookId: params.bookId }),
				);
				const result = await Effect.runPromise(
					Effect.either(runnable.pipe(Effect.provide(AppLayer))),
				);

				if (Either.isLeft(result)) {
					if (
						result.left._tag === "StorageError" &&
						result.left.operation === "file.notFound"
					) {
						return new Response("Not found", {
							status: 404,
							headers: {
								"cache-control": "no-store",
							},
						});
					}

					return new Response("Failed to load cover", {
						status: 500,
						headers: {
							"cache-control": "no-store",
						},
					});
				}

				const coverObject = result.right;

				const contentType =
					coverObject.httpMetadata?.contentType ?? "image/jpeg";

				const headers = new Headers();
				headers.set("content-type", contentType);
				headers.set("cache-control", "public, max-age=31536000, immutable");

				return new Response(coverObject.body, { status: 200, headers });
			},
		},
	},
});
