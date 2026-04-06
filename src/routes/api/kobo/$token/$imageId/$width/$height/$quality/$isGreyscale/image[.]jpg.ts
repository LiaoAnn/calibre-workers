import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import { r2Keys } from "#/lib/r2-keys";
import { withKoboAuth } from "#/server/koboApi";
import { getBookFile } from "#/services/FileService";
import { getBookByUuid } from "#/services/KoboService";

const KOBO_IMAGEHOST_URL = "https://cdn.kobo.com/book-images";

export const Route = createFileRoute(
	"/api/kobo/$token/$imageId/$width/$height/$quality/$isGreyscale/image.jpg",
)({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, async ({ params }) => {
					const bookResult = await Effect.runPromise(
						Effect.either(
							getBookByUuid(params.imageId).pipe(Effect.provide(AppLayer)),
						),
					);

					if (Either.isRight(bookResult) && bookResult.right.hasCover) {
						const coverResult = await Effect.runPromise(
							Effect.either(
								getBookFile(
									r2Keys.bookCover({ bookId: bookResult.right.id }),
								).pipe(Effect.provide(AppLayer)),
							),
						);

						if (Either.isRight(coverResult)) {
							const headers = new Headers();
							headers.set(
								"content-type",
								coverResult.right.httpMetadata?.contentType ?? "image/jpeg",
							);
							headers.set("cache-control", "public, max-age=3600");

							return {
								response: new Response(coverResult.right.body, {
									status: 200,
									headers,
								}),
								isHandledInternally: true,
							};
						}
					}

					const imageId = encodeURIComponent(params.imageId);
					const width = encodeURIComponent(params.width);
					const height = encodeURIComponent(params.height);
					const quality = encodeURIComponent(params.quality);
					const isGreyscale = encodeURIComponent(params.isGreyscale);
					const redirectUrl = `${KOBO_IMAGEHOST_URL}/${imageId}/${width}/${height}/${quality}/${isGreyscale}/image.jpg`;

					return {
						response: new Response(null, {
							status: 307,
							headers: { location: redirectUrl },
						}),
						isHandledInternally: false,
					};
				}),
		},
	},
});
