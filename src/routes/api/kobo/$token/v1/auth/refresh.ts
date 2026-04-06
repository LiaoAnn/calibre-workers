import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboAuthResponse,
	koboJsonErrorResponse,
	koboJsonResponse,
	parseDeviceAuthBody,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import {
	buildDummyAuthResponse,
	proxyKoboRequest,
} from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/auth/refresh")({
	server: {
		handlers: {
			POST: async (input) =>
				withKoboAuth(input, async ({ request, koboToken }) => {
					try {
						const { response } = await Effect.runPromise(
							proxyKoboRequest({
								request: request.clone(),
								token: koboToken,
							}).pipe(Effect.provide(AppLayer)),
						);
						return { response, isHandledInternally: false };
					} catch {
						let userKey: string | null = null;
						try {
							const body = (await request.clone().json()) as unknown;
							const parsedBody = parseDeviceAuthBody(body);
							userKey = parsedBody?.userKey ?? null;
						} catch {
							userKey = null;
						}

						const fallback = buildDummyAuthResponse(userKey);
						const encodedFallback = encodeKoboAuthResponse(fallback);
						if (!encodedFallback) {
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
							response: koboJsonResponse(encodedFallback, { status: 200 }),
							isHandledInternally: true,
						};
					}
				}),
		},
	},
});
