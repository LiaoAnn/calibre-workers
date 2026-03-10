import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { r2Keys } from "#/lib/r2-keys";
import { requiredSessionMiddleware } from "#/middleware/auth";
import { createBookFromUpload } from "#/services/BookService";
import type { EpubMetadata } from "#/services/EpubService";
import { parseEpubCover, parseEpubMetadata } from "#/services/EpubService";
import { uploadBookFile } from "#/services/FileService";

export const uploadBookServerFn = createServerFn({ method: "POST" })
	.middleware([requiredSessionMiddleware])
	.inputValidator((input: FormData) => input)
	.handler(async ({ data }) => {
		const file = data.get("file");
		const author = data.get("author");
		const title = data.get("title");

		if (!(file instanceof File)) {
			throw new Error("Missing file");
		}

		const fileBuffer = await file.arrayBuffer();
		const isEpub =
			file.name.toLowerCase().endsWith(".epub") || file.type.includes("epub");

		const runnable = Effect.gen(function* () {
			const extractedMetadata: EpubMetadata = isEpub
				? yield* parseEpubMetadata(fileBuffer).pipe(
						Effect.catchAll(() => Effect.succeed({} as EpubMetadata)),
					)
				: ({} as EpubMetadata);

			const cover = isEpub
				? yield* parseEpubCover(fileBuffer).pipe(
						Effect.catchAll(() => Effect.succeed(undefined)),
					)
				: undefined;

			const resolvedTitle =
				typeof title === "string" && title.trim().length > 0
					? title.trim()
					: extractedMetadata.title?.trim() ||
						file.name.replace(/\.[^.]+$/, "");
			const resolvedAuthor =
				typeof author === "string" && author.trim().length > 0
					? author.trim()
					: extractedMetadata.author?.trim() || "Unknown";

			const created = yield* createBookFromUpload({
				title: resolvedTitle,
				author: resolvedAuthor,
				fileName: file.name,
				mimeType: file.type || undefined,
				size: file.size,
				hasCover: !!cover,
			});

			yield* uploadBookFile({
				r2Key: created.file.r2Key,
				body: fileBuffer,
				contentType: file.type || undefined,
			});

			if (cover) {
				yield* uploadBookFile({
					r2Key: r2Keys.bookCover({ bookId: created.book.id }),
					body: cover.data,
					contentType: cover.mimeType,
				});
			}

			return {
				bookId: created.book.id,
				title: created.book.title,
			};
		});

		return Effect.runPromise(runnable.pipe(Effect.provide(AppLayer)));
	});
