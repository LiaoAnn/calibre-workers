import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { AppLayer } from "#/layers/AppLayer";
import {
	encodeKoboAnalyticsTestsResponse,
	encodeKoboBenefitsResponse,
	encodeKoboEmptyObjectResponse,
	koboJsonErrorResponse,
	koboJsonResponse,
} from "#/lib/kobo.server";
import { withKoboAuth } from "#/server/koboApi";
import { proxyKoboRequest } from "#/services/KoboService";

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
}): Response => {
	if (v1Path === "user/loyalty/benefits") {
		const payload = encodeKoboBenefitsResponse({ Benefits: {} });
		if (!payload) {
			return koboJsonErrorResponse({
				status: 500,
				message: "Internal Server Error",
				code: "InternalServerError",
			});
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
			return koboJsonErrorResponse({
				status: 500,
				message: "Internal Server Error",
				code: "InternalServerError",
			});
		}

		return koboJsonResponse(payload, { status: 200 });
	}

	const payload = encodeKoboEmptyObjectResponse({});
	if (!payload) {
		return koboJsonErrorResponse({
			status: 500,
			message: "Internal Server Error",
			code: "InternalServerError",
		});
	}

	return koboJsonResponse(payload, { status: 200 });
};

const handleKoboV1FallbackRoute = async ({
	request,
	koboToken,
}: {
	request: RequestLike;
	koboToken: string;
}) => {
	const v1Path = getV1RelativePath(new URL(request.url).pathname);

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
			response: buildFallbackResponse({ request, v1Path }),
			isHandledInternally: true,
		};
	}
};

export const Route = createFileRoute("/api/kobo/$token/v1/$")({
	server: {
		handlers: {
			DELETE: async (input) =>
				withKoboAuth(input, async ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
			GET: async (input) =>
				withKoboAuth(input, async ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
			PATCH: async (input) =>
				withKoboAuth(input, async ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
			POST: async (input) =>
				withKoboAuth(input, async ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
			PUT: async (input) =>
				withKoboAuth(input, async ({ request, koboToken }) =>
					handleKoboV1FallbackRoute({ request, koboToken }),
				),
		},
	},
});
