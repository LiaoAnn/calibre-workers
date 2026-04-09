import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import {
	encodeKoboAuthResponse,
	KoboEncodingFailure,
	koboJsonResponse,
	parseDeviceAuthBody,
} from "#/lib/kobo.server";
import { proxyKoboHandlerOutput, withKoboAuth } from "#/server/koboApi";
import { buildDummyAuthResponse } from "#/services/KoboService";

export const Route = createFileRoute("/api/kobo/$token/v1/auth/refresh")({
	server: {
		handlers: {
			POST: async (input) =>
				withKoboAuth(input, ({ request, koboToken }) =>
					Effect.gen(function* () {
						const proxied = yield* Effect.either(
							proxyKoboHandlerOutput({
								request,
								token: koboToken,
							}),
						);

						if (Either.isRight(proxied)) {
							return proxied.right;
						}

						const parsedBodyResult = yield* Effect.either(
							Effect.tryPromise({
								try: () => request.clone().json() as Promise<unknown>,
								catch: () => null,
							}),
						);

						const parsedBody = Either.isRight(parsedBodyResult)
							? parseDeviceAuthBody(parsedBodyResult.right)
							: null;
						const userKey = parsedBody?.userKey ?? null;

						const fallback = buildDummyAuthResponse(userKey);
						const encodedFallback = encodeKoboAuthResponse(fallback);
						if (!encodedFallback) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "auth.refresh.encodeFallbackResponse",
								}),
							);
						}

						return {
							response: koboJsonResponse(encodedFallback, { status: 200 }),
							isHandledInternally: true,
						};
					}),
				),
		},
	},
});
