import { createFileRoute } from "@tanstack/react-router";
import { Effect, Either } from "effect";
import {
	encodeKoboAnalyticsTestsResponse,
	encodeKoboBenefitsResponse,
	encodeKoboEmptyObjectResponse,
	KoboEncodingFailure,
	koboJsonResponse,
	proxyKoboHandlerOutput,
	withKoboAuth,
} from "#/features/kobo/lib/kobo.server";

type RequestLike = Pick<
	Request,
	"method" | "url" | "headers" | "clone" | "body" | "formData" | "arrayBuffer"
>;

const getV1RelativePath = (pathname: string): string => {
	const marker = "/v1/";
	const index = pathname.indexOf(marker);
	if (index < 0) {
		return "";
	}

	return pathname.slice(index + marker.length);
};

const buildFallbackResponse = ({
	request,
	v1Path,
}: {
	request: RequestLike;
	v1Path: string;
}) =>
	Effect.gen(function* () {
		if (v1Path === "user/loyalty/benefits") {
			const payload = encodeKoboBenefitsResponse({ Benefits: {} });
			if (!payload) {
				return yield* Effect.fail(
					new KoboEncodingFailure({
						operation: "v1.catchall.encodeBenefits",
					}),
				);
			}

			return koboJsonResponse(payload, { status: 200 });
		}

		if (v1Path === "analytics/gettests") {
			const userKey = request.headers.get("x-kobo-userkey") ?? "";
			const payload = encodeKoboAnalyticsTestsResponse({
				Result: "Success",
				TestKey: userKey,
				Tests: {},
			});
			if (!payload) {
				return yield* Effect.fail(
					new KoboEncodingFailure({
						operation: "v1.catchall.encodeAnalyticsTests",
					}),
				);
			}

			return koboJsonResponse(payload, { status: 200 });
		}

		const payload = encodeKoboEmptyObjectResponse({});
		if (!payload) {
			return yield* Effect.fail(
				new KoboEncodingFailure({
					operation: "v1.catchall.encodeEmptyObject",
				}),
			);
		}

		return koboJsonResponse(payload, { status: 200 });
	});

const handleKoboV1FallbackRoute = ({
	request,
	koboToken,
}: {
	request: RequestLike;
	koboToken: string;
}) =>
	Effect.gen(function* () {
		const v1Path = getV1RelativePath(new URL(request.url).pathname);
		const proxied = yield* Effect.either(
			proxyKoboHandlerOutput({
				request,
				token: koboToken,
			}),
		);

		if (Either.isRight(proxied)) {
			return proxied.right;
		}

		return {
			response: yield* buildFallbackResponse({ request, v1Path }),
			isHandledInternally: true,
		};
	});

export const Route = createFileRoute("/api/kobo/$token/v1/$")({
	server: {
		handlers: {
			DELETE: async (input) =>
				withKoboAuth(input, ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
			GET: async (input) =>
				withKoboAuth(input, ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
			PATCH: async (input) =>
				withKoboAuth(input, ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
			POST: async (input) =>
				withKoboAuth(input, ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
			PUT: async (input) =>
				withKoboAuth(input, ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
		},
	},
});
