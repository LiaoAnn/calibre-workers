import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import {
	encodeKoboInitializationResponse,
	KoboEncodingFailure,
	koboInitializationResourceSnapshot,
	koboJsonResponse,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import { buildInitializationResources } from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/initialization")({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, ({ request, koboToken }) =>
					Effect.gen(function* () {
						const origin = new URL(request.url).origin;

						const resources = buildInitializationResources({
							origin,
							token: koboToken,
							upstreamResources: koboInitializationResourceSnapshot,
						});

						const encodedInitializationPayload =
							encodeKoboInitializationResponse({ Resources: resources });
						if (!encodedInitializationPayload) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "initialization.encodeResponse",
								}),
							);
						}

						const response = koboJsonResponse(encodedInitializationPayload, {
							status: 200,
							headers: {
								"x-kobo-apitoken": "e30=",
							},
						});

						return {
							response,
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
