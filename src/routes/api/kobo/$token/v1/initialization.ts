import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboInitializationResponse,
	koboJsonErrorResponse,
	koboJsonResponse,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import {
	buildInitializationResources,
	proxyKoboRequest,
} from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/initialization")({
	server: {
		handlers: {
			GET: async (input) =>
				withKoboAuth(input, async ({ request, koboToken }) => {
					const origin = new URL(request.url).origin;
					let upstreamResources: Record<string, unknown> | undefined;

					try {
						// We best-effort probe upstream initialization so official resource
						// URLs can stay in sync, then override endpoints we handle locally.
						const { response } = await Effect.runPromise(
							proxyKoboRequest({
								request: request.clone(),
								token: koboToken,
							}).pipe(Effect.provide(AppLayer)),
						);
						const json = (await response.clone().json()) as {
							Resources?: Record<string, unknown>;
						};
						upstreamResources = json.Resources;
					} catch {
						upstreamResources = undefined;
					}

					const resources = buildInitializationResources({
						origin,
						token: koboToken,
						upstreamResources,
					});

					const encodedInitializationPayload = encodeKoboInitializationResponse(
						{ Resources: resources },
					);
					if (!encodedInitializationPayload) {
						return {
							response: koboJsonErrorResponse({
								status: 500,
								message: "Internal Server Error",
								code: "InternalServerError",
							}),
							isHandledInternally: true,
						};
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
		},
	},
});
