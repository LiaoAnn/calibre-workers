import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import {
	encodeKoboEmptyTextResponse,
	KOBO_TEXT_HEADERS,
	KoboEncodingFailure,
	KoboMalformedRequest,
	parseTagItemsBody,
	withKoboAuth,
} from "#/features/kobo/lib/kobo.server";
import { addItemsToKoboTag } from "#/features/kobo/services/KoboService";

export const Route = createFileRoute(
	"/api/kobo/$token/v1/library/tags/$tagId/items",
)({
	server: {
		handlers: {
			POST: async (input) =>
				withKoboAuth(input, ({ request, params, koboAuth }) =>
					Effect.gen(function* () {
						const body = yield* Effect.tryPromise({
							try: () => request.clone().json() as Promise<unknown>,
							catch: () =>
								new KoboMalformedRequest({ reason: "Malformed tags request" }),
						});

						const revisionIds = parseTagItemsBody(body);
						if (!revisionIds) {
							return yield* Effect.fail(
								new KoboMalformedRequest({ reason: "Malformed tags request" }),
							);
						}

						yield* addItemsToKoboTag({
							userId: koboAuth.userId,
							tagId: params.tagId,
							revisionIds,
						});

						const encodedResponse = encodeKoboEmptyTextResponse("");
						if (!encodedResponse) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "library.tag.items.encodeEmptyText",
								}),
							);
						}

						return {
							response: new Response(encodedResponse, {
								status: 201,
								headers: KOBO_TEXT_HEADERS,
							}),
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
