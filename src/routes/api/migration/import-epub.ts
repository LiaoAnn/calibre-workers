import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { r2Keys } from "#/lib/r2-keys";
import { createBookFromUpload, deleteBook } from "#/services/BookService";
import type { EpubMetadata } from "#/services/EpubService";
import { parseEpubCover, parseEpubMetadata } from "#/services/EpubService";
import { deleteBookFile, uploadBookFile } from "#/services/FileService";

const isSupportedUploadFile = (file: File) =>
	file.name.toLowerCase().endsWith(".epub") ||
	file.type.toLowerCase().includes("epub");

const jsonResponse = (status: number, payload: unknown) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: {
			"content-type": "application/json",
		},
	});

export const Route = createFileRoute("/api/migration/import-epub")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const expectedSecret = env.MIGRATION_SECRET?.trim();
				if (!expectedSecret) {
					return jsonResponse(500, {
						error: "MIGRATION_SECRET is not configured",
					});
				}

				const providedSecret =
					request.headers.get("x-migration-secret")?.trim() ?? "";
				if (providedSecret.length === 0 || providedSecret !== expectedSecret) {
					return jsonResponse(401, { error: "Unauthorized" });
				}

				let data: FormData;
				try {
					data = await request.formData();
				} catch {
					return jsonResponse(400, { error: "Invalid form data" });
				}

				const file = data.get("file");
				if (!(file instanceof File)) {
					return jsonResponse(400, { error: "Missing file" });
				}

				if (!isSupportedUploadFile(file)) {
					return jsonResponse(400, {
						error: "Unsupported file format. Only .epub is allowed.",
					});
				}

				const createdAtRaw = data.get("customCreatedAt");
				if (
					typeof createdAtRaw !== "string" ||
					createdAtRaw.trim().length === 0
				) {
					return jsonResponse(400, {
						error: "Missing customCreatedAt",
					});
				}

				const createdAt = new Date(createdAtRaw);
				if (Number.isNaN(createdAt.getTime())) {
					return jsonResponse(400, {
						error: "Invalid customCreatedAt",
					});
				}

				const author = data.get("author");
				const title = data.get("title");
				const fileStream = file.stream();

				const runnable = Effect.gen(function* () {
					const fileBuffer = yield* Effect.tryPromise({
						try: () => file.arrayBuffer(),
						catch: () => new Error("Failed to read file"),
					});

					const extractedMetadata: EpubMetadata = yield* parseEpubMetadata(
						fileBuffer,
					).pipe(Effect.catchAll(() => Effect.succeed({} as EpubMetadata)));

					const cover = yield* parseEpubCover(fileBuffer).pipe(
						Effect.catchAll(() => Effect.succeed(undefined)),
					);

					const resolvedTitle =
						typeof title === "string" && title.trim().length > 0
							? title.trim()
							: extractedMetadata.title?.trim() ||
								file.name.replace(/\.[^.]+$/, "");

					const resolvedAuthors =
						typeof author === "string" && author.trim().length > 0
							? [author.trim()]
							: (extractedMetadata.authors?.filter(
									(a) => a.trim().length > 0,
								) ?? []);

					const resolvedPubdate = extractedMetadata.pubdate
						? (() => {
								const parsed = new Date(extractedMetadata.pubdate as string);
								return Number.isNaN(parsed.getTime()) ? undefined : parsed;
							})()
						: undefined;

					const createdResources = {
						bookId: undefined as string | undefined,
						fileR2Key: undefined as string | undefined,
						coverR2Key: undefined as string | undefined,
					};

					const performRollback = () =>
						Effect.gen(function* () {
							if (createdResources.fileR2Key) {
								yield* deleteBookFile(createdResources.fileR2Key).pipe(
									Effect.catchAll(() => Effect.succeed(undefined)),
								);
							}

							if (createdResources.coverR2Key) {
								yield* deleteBookFile(createdResources.coverR2Key).pipe(
									Effect.catchAll(() => Effect.succeed(undefined)),
								);
							}

							if (createdResources.bookId) {
								yield* deleteBook(createdResources.bookId).pipe(
									Effect.catchAll(() => Effect.succeed(undefined)),
								);
							}
						});

					const uploadEffect = Effect.gen(function* () {
						const created = yield* createBookFromUpload({
							title: resolvedTitle,
							authors: resolvedAuthors,
							description: extractedMetadata.description,
							publisher: extractedMetadata.publisher,
							tags: extractedMetadata.tags,
							language: extractedMetadata.language,
							pubdate: resolvedPubdate,
							series: extractedMetadata.series,
							seriesIndex: extractedMetadata.seriesIndex,
							identifiers: extractedMetadata.identifiers,
							fileName: file.name,
							mimeType: file.type || undefined,
							size: file.size,
							hasCover: !!cover,
							createdAt,
						});

						createdResources.bookId = created.book.id;
						createdResources.fileR2Key = created.file.r2Key;

						yield* uploadBookFile({
							r2Key: created.file.r2Key,
							body: fileStream,
							contentType: file.type || undefined,
						});

						if (cover) {
							createdResources.coverR2Key = r2Keys.bookCover({
								bookId: created.book.id,
							});
							yield* uploadBookFile({
								r2Key: createdResources.coverR2Key,
								body: cover.data,
								contentType: cover.mimeType,
							});
						}

						return {
							bookId: created.book.id,
							title: created.book.title,
						};
					});

					return yield* uploadEffect.pipe(
						Effect.onExit((exit) => {
							if (exit._tag === "Failure") {
								return performRollback();
							}

							return Effect.succeed(undefined);
						}),
					);
				});

				try {
					const result = await Effect.runPromise(
						runnable.pipe(Effect.provide(AppLayer)),
					);
					return jsonResponse(200, { ok: true, ...result });
				} catch (error) {
					return jsonResponse(500, {
						error:
							error instanceof Error
								? error.message
								: "Migration upload failed",
					});
				}
			},
		},
	},
});
