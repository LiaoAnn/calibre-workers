import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import {
	getBookFile,
	getBookFileRecord,
} from "#/features/files/services/FileService";
import { getSessionFromMiddlewareFn } from "#/shared/auth/middleware";
import { AppLayer } from "#/shared/layers/AppLayer";

export const Route = createFileRoute("/api/books/$bookId/files/$fileId")({
	beforeLoad: async () => {
		const session = await getSessionFromMiddlewareFn();
		if (!session?.user) {
			throw new Response("Unauthorized", { status: 401 });
		}
	},
	server: {
		handlers: {
			GET: async ({ params }) => {
				const runnable = Effect.gen(function* () {
					const fileRecord = yield* getBookFileRecord(
						params.bookId,
						params.fileId,
					);

					if (
						fileRecord.metadataStatus === "pending" ||
						fileRecord.metadataStatus === "processing"
					) {
						return {
							locked: true as const,
							status: fileRecord.metadataStatus,
							fileRecord,
						};
					}

					if (fileRecord.metadataStatus === "failed") {
						return {
							locked: true as const,
							status: fileRecord.metadataStatus,
							fileRecord,
						};
					}

					const object = yield* getBookFile(fileRecord.r2Key);
					return { locked: false as const, fileRecord, object };
				});

				const result = await Effect.runPromise(
					runnable.pipe(Effect.provide(AppLayer)),
				);

				if (!result) {
					return new Response("File not found", {
						status: 404,
						headers: {
							"cache-control": "no-store",
						},
					});
				}

				if (result.locked) {
					if (result.status === "failed") {
						return new Response("File metadata synchronization failed", {
							status: 409,
							headers: {
								"cache-control": "no-store",
							},
						});
					}

					return new Response("File metadata is being synchronized", {
						status: 423,
						headers: {
							"cache-control": "no-store",
						},
					});
				}

				const headers = new Headers();
				headers.set(
					"content-type",
					result.fileRecord.mimeType || "application/octet-stream",
				);

				const fileName = result.fileRecord.fileName.replace(
					/\.kepub$/i,
					".kepub.epub",
				);
				const encodedFileName = encodeURIComponent(fileName);
				headers.set(
					"content-disposition",
					`attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
				);
				headers.set("cache-control", "no-store");

				return new Response(result.object.body, {
					status: 200,
					headers,
				});
			},
		},
	},
});
