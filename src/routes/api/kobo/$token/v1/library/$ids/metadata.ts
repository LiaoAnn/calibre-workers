import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboMetadataList,
	koboJsonErrorResponse,
	koboJsonResponse,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import {
	getBookMetadataByUuid,
	proxyKoboRequest,
} from "#/services/KoboService";

const parseIds = (value: string): string[] =>
	value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

export const Route = createFileRoute(
	"/api/kobo/$token/v1/library/$ids/metadata",
)({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, async ({ request, params, koboToken }) => {
					const ids = parseIds(params.ids);
					if (ids.length === 0) {
						return {
							response: koboJsonErrorResponse({
								status: 400,
								message: "Malformed metadata request",
								code: "MalformedRequest",
							}),
							isHandledInternally: true,
						};
					}

					const origin = new URL(request.url).origin;
					const metadataPayload: unknown[] = [];

					for (const bookUuid of ids) {
						const result = await Effect.runPromise(
							Effect.either(
								getBookMetadataByUuid({
									bookUuid,
									origin,
									token: koboToken,
								}).pipe(Effect.provide(AppLayer)),
							),
						);

						if (Either.isLeft(result)) {
							try {
								const { response } = await Effect.runPromise(
									proxyKoboRequest({
										request: request.clone(),
										token: koboToken,
									}).pipe(Effect.provide(AppLayer)),
								);

								return {
									response,
									isHandledInternally: false,
								};
							} catch {
								return {
									response: koboJsonErrorResponse({
										status: 404,
										message: "Book not found",
										code: "BookNotFound",
									}),
									isHandledInternally: true,
								};
							}
						}

						metadataPayload.push(result.right);
					}

					const encodedMetadataPayload =
						encodeKoboMetadataList(metadataPayload);
					if (!encodedMetadataPayload) {
						return {
							response: koboJsonErrorResponse({
								status: 500,
								message: "Internal Server Error",
								code: "InternalServerError",
							}),
							isHandledInternally: true,
						};
					}

					return {
						response: koboJsonResponse(encodedMetadataPayload, { status: 200 }),
						isHandledInternally: true,
					};
				}),
		},
	},
});
