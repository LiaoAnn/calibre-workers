import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import {
	buildDummyAuthResponse,
	encodeKoboAuthResponse,
	KoboEncodingFailure,
	koboJsonResponse,
	parseDeviceAuthBody,
	proxyKoboHandlerOutput,
	withKoboAuth,
} from "#/lib/kobo.server";

export const Route = createFileRoute("/api/kobo/$token/v1/auth/device")({
	server: {
		handlers: {
			POST: async (input) =>
				withKoboAuth(input, ({ request, koboToken }) =>
					Effect.gen(function* () {
						// Preferred path: pass through to official Kobo auth endpoint.
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

						// Fallback keeps devices usable when upstream auth endpoint is down.
						const fallback = buildDummyAuthResponse(userKey);
						const encodedFallback = encodeKoboAuthResponse(fallback);
						if (!encodedFallback) {
							return yield* Effect.fail(
								new KoboEncodingFailure({
									operation: "auth.device.encodeFallbackResponse",
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
