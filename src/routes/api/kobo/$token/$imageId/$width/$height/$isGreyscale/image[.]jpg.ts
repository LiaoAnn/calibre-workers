import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { withKoboAuth } from "#/lib/kobo.server";
import { r2Keys } from "#/lib/r2-keys";
import { getBookFile } from "#/services/FileService";
import { getBookByUuid } from "#/services/KoboService";

const KOBO_IMAGEHOST_URL = "https://cdn.kobo.com/book-images";

export const Route = createFileRoute(
	"/api/kobo/$token/$imageId/$width/$height/$isGreyscale/image.jpg",
)({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, ({ params }) =>
					Effect.gen(function* () {
						const bookResult = yield* Effect.either(
							getBookByUuid(params.imageId),
						);

						if (Either.isRight(bookResult) && bookResult.right.hasCover) {
							const coverResult = yield* Effect.either(
								getBookFile(r2Keys.bookCover({ bookId: bookResult.right.id })),
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
						const redirectUrl = `${KOBO_IMAGEHOST_URL}/${imageId}/${width}/${height}/false/image.jpg`;

						return {
							response: new Response(null, {
								status: 307,
								headers: { location: redirectUrl },
							}),
							isHandledInternally: false,
						};
					}),
				),
		},
	},
});
