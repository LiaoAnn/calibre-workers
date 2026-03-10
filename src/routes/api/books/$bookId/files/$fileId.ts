import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { getSessionFromMiddlewareFn } from "#/middleware/auth";
import { getBookFile, getBookFileRecord } from "#/services/FileService";

export const Route = createFileRoute("/api/books/$bookId/files/$fileId")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();
		if (!session?.user) {
			throw new Response("Unauthorized", { status: 401 });
		}
	},
	server: {
		handlers: {
			GET: async ({
				params,
			}: {
				params: { bookId: string; fileId: string };
			}) => {
				const runnable = Effect.gen(function* () {
					const fileRecord = yield* getBookFileRecord(
						params.bookId,
						params.fileId,
					);
					const object = yield* getBookFile(fileRecord.r2Key);
					return { fileRecord, object } as const;
				});

				const result = await Effect.runPromise(
					runnable.pipe(Effect.provide(AppLayer)),
				);

				if (!result) {
					return new Response("File not found", { status: 404 });
				}

				const headers = new Headers();
				headers.set(
					"content-type",
					result.fileRecord.mimeType || "application/octet-stream",
				);
				headers.set(
					"content-disposition",
					`attachment; filename="${result.fileRecord.fileName}"`,
				);

				return new Response(result.object.body, {
					status: 200,
					headers,
				});
			},
		},
	},
});
