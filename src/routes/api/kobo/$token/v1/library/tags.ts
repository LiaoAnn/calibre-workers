import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import {
	encodeKoboTagId,
	KoboEncodingFailure,
	KoboMalformedRequest,
	KoboMethodNotAllowed,
	koboJsonResponse,
	parseCreateTagBody,
} from "#/features/kobo/lib/kobo.server";
import { withKoboAuth } from "#/features/kobo/server/withKoboAuth";
import { KoboService } from "#/features/kobo/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/library/tags")({
	server: {
		handlers: {
			DELETE: async (input) =>
				withKoboAuth(input, () => Effect.fail(new KoboMethodNotAllowed({}))),
			POST: async (input) =>
				withKoboAuth(input, ({ request, koboAuth }) =>
					Effect.gen(function* () {
						const body = yield* Effect.tryPromise({
							try: () => request.clone().json() as Promise<unknown>,
							catch: () =>
								new KoboMalformedRequest({ reason: "Malformed tags request" }),
						});

						const parsedBody = parseCreateTagBody(body);
						if (!parsedBody) {
							return yield* Effect.fail(
								new KoboMalformedRequest({ reason: "Malformed tags request" }),
							);
						}

						const result = yield* KoboService.createOrUpdateKoboTag({
							userId: koboAuth.userId,
							name: parsedBody.name,
							revisionIds: parsedBody.revisionIds,
						});

						const encodedTagId = encodeKoboTagId(result.tagId);
						if (!encodedTagId) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "library.tags.encodeTagId",
								}),
							);
						}

						return {
							response: koboJsonResponse(encodedTagId, { status: 201 }),
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
