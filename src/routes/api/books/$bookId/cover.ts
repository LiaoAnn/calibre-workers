import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { r2Keys } from "#/lib/r2-keys";
import { getBookFile } from "#/services/FileService";

export const Route = createFileRoute("/api/books/$bookId/cover")({
	server: {
		handlers: {
			GET: async ({ params }: { params: { bookId: string } }) => {
				const runnable = getBookFile(
					r2Keys.bookCover({ bookId: params.bookId }),
				);

				const result = await Effect.runPromise(
					runnable.pipe(Effect.provide(AppLayer)),
				);

				if (!result) {
					return new Response("Not found", { status: 404 });
				}

				const contentType = result.httpMetadata?.contentType ?? "image/jpeg";

				const headers = new Headers();
				headers.set("content-type", contentType);
				headers.set("cache-control", "public, max-age=31536000, immutable");

				return new Response(result.body, { status: 200, headers });
			},
		},
	},
});
